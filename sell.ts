import { PublicKey } from "@solana/web3.js";
import { MAIN_KP } from "./config";
import { main_menu_display, rl } from "./menu";
import { sellPumpTokenByRacing } from "./dex/pumpfun";
import { sleep } from "./dex/pumpfun/sdk/util";
import { readDataJson } from "./utils/utils";
const MenuChoices = {
  MAIN: {
    ManualSell_100: 0,
    ManualSell_50: 1,
    EXIT: 1,
  },
};

const promptUser = async (message: string): Promise<number> => {
  return new Promise((resolve) => {
    rl.question(message, (answer: string) => {
      // Ensure valid input and resolve it as a number
      const choice = parseInt(answer);
      resolve(isNaN(choice) ? -1 : choice);
    });
  });
};

const handleMainMenuChoice = async (choice: number) => {
  switch (choice) {
    case MenuChoices.MAIN.ManualSell_100: await handleManualSell(); break;
    case MenuChoices.MAIN.ManualSell_50: await handleManualSell(0.5); break;  // manual sell 50%
    case MenuChoices.MAIN.EXIT: process.exit(1); break;
    default: console.log("\tInvalid choice!"); break;
  }
};

const handleManualSell = async (percent: number = 1) => {
  const data = await readDataJson("tradedTokens.json")
  if (data.length > 0) {
    const lastBoughtTokenMint = data[data.length - 1].mint
    // console.log("lastBoughtTokenMint", lastBoughtTokenMint)
    await sellPumpTokenByRacing(
      MAIN_KP,
      new PublicKey(lastBoughtTokenMint),
      500000000,
      percent
    )
  }
}


export const init = async () => {
  console.log("Maunal Sell...");

  main_menu_display();

  const choice = await promptUser("\t[Main] - Choice: ");
  await handleMainMenuChoice(choice);
  sleep(500);
  init();  // Restart the main menu
};


init()
