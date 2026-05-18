
import fs from 'fs';
import dotenv from 'dotenv';
import metadata from './metadata';
import axios from 'axios';
import FormData from 'form-data';
dotenv.config();

const imageName = "./upload/bolt.jpg";
const metadataName = "./upload/metadata.json";

async function uploadFileToIPFS(filename: string) {
  const url = `https://api.pinata.cloud/pinning/pinFileToIPFS`;
  const data = new FormData();
  data.append('file', fs.createReadStream(filename));
  const res = await axios.post(url, data, {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${data.getBoundary()}`,
    },
  });
  return res.data.IpfsHash;
}

export const getUploadedMetadataURI = async (): Promise<string> => {
  try {
    const imageUploadResult = await uploadFileToIPFS(imageName);
    console.log('Image uploaded to IPFS:', imageUploadResult);
    console.log('IPFS URL:', `https://ipfs.io/ipfs/${imageUploadResult}`);

    const data = {
      "name": metadata.name,
      "symbol": metadata.symbol,
      "description": metadata.description,
      "image": `https://ipfs.io/ipfs/${imageUploadResult}`,
      "showName": metadata.showName,
      "createdOn": metadata.createdOn,
      "twitter": metadata.twitter,
      "telegram": metadata.telegram,
      "website": metadata.website
    }
    const metadataString = JSON.stringify(data);
    const bufferContent = Buffer.from(metadataString, 'utf-8');
    fs.writeFileSync(metadataName, bufferContent);
    const metadataContent = fs.readFileSync(metadataName);

    const metadataUploadResult = await uploadFileToIPFS(metadataName);
    console.log('File uploaded to IPFS:', metadataUploadResult);
    console.log('IPFS URL:', `https://ipfs.io/ipfs/${metadataUploadResult}`)
    return `https://ipfs.io/ipfs/${metadataUploadResult}`;
  } catch (error) {
    return "";
  }
}