import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey().toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");

console.log(`VITE_WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
