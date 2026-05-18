import {
  Commitment,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import { setGlobalDispatcher, Agent } from 'undici'
import { GlobalAccount } from "./globalAccount";
import {
  CompleteEvent,
  CreateEvent,
  CreateTokenMetadata,
  PriorityFee,
  PumpFunEventHandlers,
  PumpFunEventType,
  SetParamsEvent,
  TradeEvent,
  TransactionResult,
} from "./types";
import {
  toCompleteEvent,
  toCreateEvent,
  toSetParamsEvent,
  toTradeEvent,
} from "./events";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { BN } from "bn.js";
import {
  DEFAULT_COMMITMENT,
  DEFAULT_FINALITY,
  buildTx,
  calculateWithSlippageBuy,
  calculateWithSlippageSell,
  getRandomInt,
  sendTx,
} from "./util";
import { PumpFun, IDL } from "./idl/index";


const PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const MPL_TOKEN_METADATA_PROGRAM_ID =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const METADATA_SEED = "metadata";

export const DEFAULT_DECIMALS = 6;

export class PumpFunSDK {
  public program: Program<PumpFun>;
  public connection: Connection;
  constructor(provider?: Provider) {
    this.program = new Program<PumpFun>(IDL as PumpFun, provider);
    this.connection = this.program.provider.connection;
  }

  async sell(
    seller: Keypair,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = BigInt(500),
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
  ): Promise<TransactionResult> {
    let sellTx = await this.getSellInstructionsByTokenAmount(
      seller.publicKey,
      mint,
      sellTokenAmount,
      slippageBasisPoints,
      commitment
    );

    let sellResults = await sendTx(
      this.connection,
      sellTx,
      seller.publicKey,
      [seller],
      priorityFees,
      commitment,
      finality
    );
    return sellResults;
  }

  //create token instructions
  async getCreateInstructions(
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair
  ) {
    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

    return this.program.methods
      .create(name, symbol, uri, creator)
      .accountsPartial({
        mint: mint.publicKey,
        user: creator,
      })
      .signers([mint])
      .instruction();
  }

  async getBuyInstructionsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    index: number,
    buyExisting: boolean = true,
    creator: PublicKey | null = null,
  ) {
    // Use hardcoded initial bonding curve values (fresh pumpfun curve at creation)
    // Cannot fetch from chain because the token hasn't been created yet at bundle time
    const bondingCurveAccount = new BondingCurveAccount(
      6966180631402821399n,
      1073000000000000n,
      30000000000n,
      793100000000000n,
      0n,
      1000000000000000n,
      false,
      new PublicKey("11111111111111111111111111111111"),
    );

    let buyAmount: bigint
    if (index == 0)
      buyAmount = bondingCurveAccount!.getBuyPrice(buyAmountSol);
    else
      buyAmount = bondingCurveAccount!.getBuyPrice(BigInt(Number(buyAmountSol) * (index + 1))) - bondingCurveAccount!.getBuyPrice(BigInt(Number(buyAmountSol) * index))

    let buyAmountWithSlippage = await this.connection.getBalance(buyer)
    return await this.getBuyInstructions(
      buyer,
      mint,
      new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
      buyAmount * BigInt(8) / BigInt(10),
      BigInt(buyAmountWithSlippage - 10 ** 6),
      buyExisting,
      creator
    );
  }

  getUserVolumeAccumulator(user: PublicKey) {
    const seeds = [
      Buffer.from("user_volume_accumulator"),
      user.toBuffer()
    ];
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      seeds,
      this.program.programId
    );
    return userVolumeAccumulator;
  }

  /** Mint account owner must be SPL Token or Token-2022. */
  async resolveTokenProgramForMint(
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
  ): Promise<PublicKey> {
    const info = await this.connection.getAccountInfo(mint, commitment);
    if (!info) {
      throw new Error(`Mint not found: ${mint.toBase58()}`);
    }
    if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    throw new Error(
      `Mint ${mint.toBase58()} owner ${info.owner.toBase58()} is not Tokenkeg… or TokenzQd… (SPL / Token-2022)`
    );
  }

  //buy
  async getBuyInstructions(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    buyExisting: boolean = true,
    creator: PublicKey | null = null,
    commitment: Commitment = DEFAULT_COMMITMENT,
  ) {
    const tokenProgram = await this.resolveTokenProgramForMint(mint, commitment);
    let bondingCurveData: BondingCurveAccount | null = null
    if (buyExisting)
      bondingCurveData = await this.getBondingCurveAccount(mint)
    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false, tokenProgram);
    if (buyExisting && !bondingCurveData) {
      return []
    }

    const curveCreator = buyExisting ? bondingCurveData!.creator : creator!;
    const ixs: TransactionInstruction[] = [
      createAssociatedTokenAccountInstruction(
        buyer,
        associatedUser,
        buyer,
        mint,
        tokenProgram
      ),
    ];

    const uva = this.getUserVolumeAccumulator(buyer);
    const uvaInfo = await this.connection.getAccountInfo(uva, commitment);
    if (!uvaInfo) {
      ixs.push(await this.buildInitUserVolumeAccumulatorIx(buyer, buyer));
    }

    const bondingCurveV2Info = await this.connection.getAccountInfo(
      this.getBondingCurveV2Pda(mint),
      commitment
    );
    if (bondingCurveV2Info && bondingCurveData) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const totalFeeBps =
        globalAccount.feeBasisPoints + globalAccount.creatorFeeBasisPoints;
      const tokenAmount = this.estimateTokenAmountForMaxSol(
        bondingCurveData,
        solAmount,
        totalFeeBps
      );
      ixs.push(
        await this.buildBuyWithBondingCurveV2(
          buyer,
          mint,
          feeRecipient,
          tokenAmount,
          solAmount,
          curveCreator,
          tokenProgram
        )
      );
    } else {
      ixs.push(
        await this.buildBuyExactSolInLegacy(
          buyer,
          mint,
          feeRecipient,
          solAmount,
          amount,
          curveCreator,
          tokenProgram
        )
      );
    }
    return ixs;
  }

  async getBuyIxsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    buyExisting: boolean = true,
    slippageBasisPoints: bigint = BigInt(500),
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    // let bondingCurveAccount = await this.getBondingCurveAccount(
    //   global_mint,
    //   commitment
    // );
    // if (!bondingCurveAccount) {
    //   throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    // }

    const bondingCurveAccount = new BondingCurveAccount(
      6966180631402821399n,
      1073000000000000n,
      30000000000n,
      793100000000000n,
      0n,
      1000000000000000n,
      false,
      new PublicKey("11111111111111111111111111111111")
    )

    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    let buyAmountWithSlippage = calculateWithSlippageBuy(
      buyAmountSol,
      slippageBasisPoints
    );
    let globalAccount = await this.getGlobalAccount(commitment);

    return await this.getBuyIxs(
      buyer,
      mint,
      globalAccount.feeRecipient,
      buyAmount * BigInt(9) / BigInt(10),
      buyAmountWithSlippage,
      buyExisting
    );
  }

  getCreatorVaultPda(programId: PublicKey, creator: PublicKey) {
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      programId,
    );
    return creatorVault;
  }

  //buy
  async getBuyIxs(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    buyExisting: boolean,
    commitment: Commitment = DEFAULT_COMMITMENT,
  ) {
    const tokenProgram = await this.resolveTokenProgramForMint(mint, commitment);
    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false, tokenProgram);
    let ixs: TransactionInstruction[] = [];
    try {
      await getAccount(this.connection, associatedUser, commitment, tokenProgram);
    } catch (e) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          buyer,
          associatedUser,
          buyer,
          mint,
          tokenProgram
        )
      );
    }

    const bondingCurveData = await this.getBondingCurveAccount(mint);
    if (buyExisting && !bondingCurveData) return [];

    const curveCreator =
      buyExisting && bondingCurveData ? bondingCurveData.creator : buyer;

    const uva = this.getUserVolumeAccumulator(buyer);
    const uvaInfo = await this.connection.getAccountInfo(uva, commitment);
    if (!uvaInfo) {
      ixs.push(await this.buildInitUserVolumeAccumulatorIx(buyer, buyer));
    }

    // Pump.fun UI uses `buy` + trailing bonding-curve-v2 for create_v2 (Token-2022) mints.
    // Relying on getAccountInfo(bonding-curve-v2) can be flaky across RPCs/commitments and
    // causes fallback to BuyExactSolIn → 6024 for some Token-2022 mints.
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID) && bondingCurveData) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const totalFeeBps =
        globalAccount.feeBasisPoints + globalAccount.creatorFeeBasisPoints;
      const tokenAmount = this.estimateTokenAmountForMaxSol(
        bondingCurveData,
        solAmount,
        totalFeeBps
      );
      ixs.push(
        await this.buildBuyWithBondingCurveV2(
          buyer,
          mint,
          feeRecipient,
          tokenAmount,
          solAmount,
          curveCreator,
          tokenProgram
        )
      );
    } else {
      const bondingCurveV2Info = await this.connection.getAccountInfo(
        this.getBondingCurveV2Pda(mint),
        commitment
      );
      if (bondingCurveV2Info && bondingCurveData) {
        const globalAccount = await this.getGlobalAccount(commitment);
        const totalFeeBps =
          globalAccount.feeBasisPoints + globalAccount.creatorFeeBasisPoints;
        const tokenAmount = this.estimateTokenAmountForMaxSol(
          bondingCurveData,
          solAmount,
          totalFeeBps
        );
        ixs.push(
          await this.buildBuyWithBondingCurveV2(
            buyer,
            mint,
            feeRecipient,
            tokenAmount,
            solAmount,
            curveCreator,
            tokenProgram
          )
        );
      } else {
        ixs.push(
          await this.buildBuyExactSolInLegacy(
            buyer,
            mint,
            feeRecipient,
            solAmount,
            amount,
            curveCreator,
            tokenProgram
          )
        );
      }
    }
    return ixs;
  }

  /** Tokens purchasable for ~maxSol lamports (matches pump.fun `buy` ix sizing). */
  estimateTokenAmountForMaxSol(
    bonding: BondingCurveAccount,
    maxSolLamports: bigint,
    totalFeeBps: bigint
  ): bigint {
    const bps = totalFeeBps > 0n ? totalFeeBps : 125n;
    const netSol = (maxSolLamports * 10000n) / (10000n + bps);
    let tokens = bonding.getBuyPrice(netSol);
    tokens = (tokens * 92n) / 100n;
    return tokens > 0n ? tokens : 1n;
  }

  //sell
  async getSellInstructionsByTokenAmount(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = BigInt(500),
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    let bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let globalAccount = await this.getGlobalAccount(commitment);

    let minSolOutput = bondingCurveAccount.getSellPrice(
      sellTokenAmount,
      globalAccount.feeBasisPoints
    );

    let sellAmountWithSlippage = calculateWithSlippageSell(
      minSolOutput,
      slippageBasisPoints
    );

    return await this.getSellInstructions(
      seller,
      mint,
      globalAccount.feeRecipient,
      sellTokenAmount,
      sellAmountWithSlippage
    );
  }

  async getSellInstructions(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint
  ) {
    const tokenProgram = await this.resolveTokenProgramForMint(mint);
    const bondingCurvePda = this.getBondingCurvePDA(mint);
    const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurvePda, true, tokenProgram);
    const associatedUser = await getAssociatedTokenAddress(mint, seller, false, tokenProgram);

    // Fetch bonding curve to get creator for creatorVault PDA
    const bondingCurveData = await this.getBondingCurveAccount(mint);
    if (!bondingCurveData) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    const [globalPda] = PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_ACCOUNT_SEED)], this.program.programId);
    const creatorVault = this.getCreatorVaultPda(this.program.programId, bondingCurveData.creator);
    const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fee_config"),
        Buffer.from([
          1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
          81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
        ]),
      ],
      feeProgram
    );
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      this.program.programId
    );

    const sellDiscriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
    const u64le = (v: bigint) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(BigInt(v));
      return b;
    };
    const data = Buffer.concat([sellDiscriminator, u64le(amount), u64le(minSolOutput)]);

    const ix = new TransactionInstruction({
      programId: this.program.programId,
      keys: [
        { pubkey: globalPda, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedUser, isSigner: false, isWritable: true },
        { pubkey: seller, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: creatorVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: this.program.programId, isSigner: false, isWritable: false }, // program
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: feeProgram, isSigner: false, isWritable: false },
      ],
      data,
    });

    let transaction = new Transaction();
    transaction.add(ix);

    return transaction;
  }

  async getBondingCurveAccount(
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    const tokenAccount = await this.connection.getAccountInfo(
      this.getBondingCurvePDA(mint),
      commitment
    );
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
  }

  async getGlobalAccount(commitment: Commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_ACCOUNT_SEED)],
      new PublicKey(PROGRAM_ID)
    );

    const tokenAccount = await this.connection.getAccountInfo(
      globalAccountPDA,
      commitment
    );
    return GlobalAccount.fromBuffer(tokenAccount!.data);
  }

  getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  getBondingCurveV2Pda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  async buildInitUserVolumeAccumulatorIx(payer: PublicKey, user: PublicKey) {
    const methods = this.program.methods as any;
    const initUvaBuilder =
      methods.initUserVolumeAccumulator ?? methods.init_user_volume_accumulator;
    if (!initUvaBuilder) {
      throw new Error(
        "PumpFunSDK: initUserVolumeAccumulator method not found on program"
      );
    }
    return await initUvaBuilder()
      .accountsPartial({
        payer,
        user,
        userVolumeAccumulator: this.getUserVolumeAccumulator(user),
      } as any)
      .instruction();
  }

  /**
   * pump.fun UI path for create_v2 mints: IDL `buy` (disc 66063d12…) + 17th account
   * `bonding-curve-v2` (see e.g. Solscan successful buys on Token-2022 curves).
   */
  async buildBuyWithBondingCurveV2(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    tokenAmount: bigint,
    maxSolCost: bigint,
    bondingCurveCreator: PublicKey,
    tokenProgram: PublicKey
  ): Promise<TransactionInstruction> {
    const bondingCurvePda = this.getBondingCurvePDA(mint);
    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bondingCurvePda,
      true,
      tokenProgram
    );
    const associatedUser = await getAssociatedTokenAddress(
      mint,
      buyer,
      false,
      tokenProgram
    );
    const creatorVault = this.getCreatorVaultPda(
      this.program.programId,
      bondingCurveCreator
    );
    const feeProgram = new PublicKey(
      "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
    );
    const feeConfig = new PublicKey(
      "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"
    );
    const globalVolumeAccumulator = new PublicKey(
      "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y"
    );
    const eventAuthority = new PublicKey(
      "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
    );
    const userVolumeAccumulator = this.getUserVolumeAccumulator(buyer);
    const bondingCurveV2 = this.getBondingCurveV2Pda(mint);
    const [globalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_ACCOUNT_SEED)],
      this.program.programId
    );

    const methods = this.program.methods as any;
    const buyBuilder = methods.buy;
    if (!buyBuilder) {
      throw new Error("PumpFunSDK: buy method not found on program");
    }

    const inner = await buyBuilder(
      new BN(tokenAmount.toString()),
      new BN(maxSolCost.toString()),
      { 0: true }
    )
      .accountsPartial({
        global: globalPda,
        feeRecipient,
        mint,
        bondingCurve: bondingCurvePda,
        associatedBondingCurve,
        associatedUser,
        user: buyer,
        systemProgram: SystemProgram.programId,
        tokenProgram,
        creatorVault,
        eventAuthority,
        program: this.program.programId,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram,
      } as any)
      .instruction();

    const keys = [
      ...inner.keys.map(
        (k: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }) => ({
          pubkey: k.pubkey,
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })
      ),
      { pubkey: bondingCurveV2, isSigner: false, isWritable: false },
    ];
    return new TransactionInstruction({
      programId: this.program.programId,
      keys,
      data: inner.data,
    });
  }

  /** Legacy SPL / no bonding-curve-v2 PDA: `buy_exact_sol_in` (16 accounts). */
  async buildBuyExactSolInLegacy(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    spendableSolIn: bigint,
    minTokensOut: bigint,
    bondingCurveCreator: PublicKey,
    tokenProgram: PublicKey
  ): Promise<TransactionInstruction> {
    const bondingCurvePda = this.getBondingCurvePDA(mint);
    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint,
      bondingCurvePda,
      true,
      tokenProgram
    );
    const associatedUser = await getAssociatedTokenAddress(
      mint,
      buyer,
      false,
      tokenProgram
    );
    const creatorVault = this.getCreatorVaultPda(
      this.program.programId,
      bondingCurveCreator
    );
    const feeProgram = new PublicKey(
      "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
    );
    const feeConfig = new PublicKey(
      "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"
    );
    const globalVolumeAccumulator = new PublicKey(
      "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y"
    );
    const eventAuthority = new PublicKey(
      "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
    );
    const userVolumeAccumulator = this.getUserVolumeAccumulator(buyer);

    const methods = this.program.methods as any;
    const buyExactSolInBuilder =
      methods.buyExactSolIn ?? methods.buy_exact_sol_in;
    if (!buyExactSolInBuilder) {
      throw new Error("PumpFunSDK: buyExactSolIn method not found on program");
    }

    return buyExactSolInBuilder(
      new BN(spendableSolIn.toString()),
      new BN(minTokensOut.toString()),
      { 0: false }
    )
      .accountsPartial({
        feeRecipient,
        mint,
        bondingCurve: bondingCurvePda,
        associatedBondingCurve,
        associatedUser,
        user: buyer,
        tokenProgram,
        creatorVault,
        eventAuthority,
        program: this.program.programId,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram,
      } as any)
      .instruction();
  }

   async createTokenMetadata(create: CreateTokenMetadata) {
    let formData = new FormData();
    formData.append("file", create.file),
      formData.append("name", create.name),
      formData.append("symbol", create.symbol),
      formData.append("description", create.description),
      formData.append("twitter", create.twitter || ""),
      formData.append("telegram", create.telegram || ""),
      formData.append("website", create.website || ""),
      formData.append("showName", "true");

    setGlobalDispatcher(new Agent({ connect: { timeout: 60_000 } }))
    let request = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      headers: {
        "Host": "www.pump.fun",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Referer": "https://www.pump.fun/create",
        "Origin": "https://www.pump.fun",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Priority": "u=1",
        "TE": "trailers"
      },
      body: formData,
    });
    return request.json();
  }
}