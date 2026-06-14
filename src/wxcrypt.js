// 企业微信回调消息加解密（WXBizMsgCrypt 的最小实现）
// 算法：AES-256-CBC + PKCS7，签名用 SHA1。零第三方依赖，全部走 Node 内置 crypto。
import crypto from 'node:crypto';

// EncodingAESKey 是 43 个字符，补一个 "=" 后 base64 解码得到 32 字节密钥
function getAesKey(encodingAesKey) {
  const key = Buffer.from(encodingAesKey + '=', 'base64');
  if (key.length !== 32) {
    throw new Error(`EncodingAESKey 解码后应为 32 字节，实际 ${key.length}，请检查 WXKF_AES_KEY`);
  }
  return key;
}

// 校验回调签名：sha1(sort([token, timestamp, nonce, encrypt]).join(''))
export function verifySignature(token, timestamp, nonce, encrypt, signature) {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  const calc = crypto.createHash('sha1').update(sorted).digest('hex');
  // 时序安全比较
  const a = Buffer.from(calc);
  const b = Buffer.from(signature || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 解密 Encrypt 字段，返回 { message, receiveId }
// 明文结构：16字节随机 + 4字节msg长度(大端) + msg + receiveId(corpid)
export function decrypt(encrypt, encodingAesKey) {
  const aesKey = getAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]);
  // 去掉 PKCS7 填充
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - pad);

  const content = decrypted.subarray(16); // 去掉前 16 字节随机串
  const msgLen = content.readUInt32BE(0);
  const message = content.subarray(4, 4 + msgLen).toString('utf8');
  const receiveId = content.subarray(4 + msgLen).toString('utf8');
  return { message, receiveId };
}
