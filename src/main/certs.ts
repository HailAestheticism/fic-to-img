import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import forge from 'node-forge'

/**
 * 自签证书：首次启用移动端时生成一台本地 CA（长期持有），再为当前网卡的 IP 签发服务端叶子证书。
 * 手机只需安装一次 CA 证书，之后 PC 的 IP 变化时重签叶子证书（同一 CA 签发）无需重新安装。
 * 证书落在 data/certs/，随数据目录备份。
 */

const CA_CN = '文转条图 本地根证书'
const SERVER_CN = 'fic-to-img.local'
const VALIDITY_YEARS = 10
// forge 运行时把 valueTagClass 当 ASN.1 tag 用（UTF8 可正常编码），但其类型声明写成了 asn1.Class
const UTF8_TAG = forge.asn1.Type.UTF8 as unknown as forge.asn1.Class

export interface CertBundle {
  /** CA 证书 PEM（供手机下载安装） */
  caCrt: string
  serverCrt: string
  serverKey: string
  /** 本次是否重签了叶子证书（IP 变化） */
  resigned: boolean
}

function pki(): typeof forge.pki {
  return forge.pki
}

function certPem(c: forge.pki.Certificate): string {
  return pki().certificateToPem(c)
}

function keyPem(k: forge.pki.PrivateKey): string {
  return pki().privateKeyToPem(k)
}

function makeCert(cn: string, key: forge.pki.KeyPair): forge.pki.Certificate {
  const cert = pki().createCertificate()
  cert.publicKey = key.publicKey
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(16)).slice(0, 30)
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000)
  const notAfter = new Date(Date.now() + VALIDITY_YEARS * 365 * 24 * 3600 * 1000)
  cert.validity.notBefore = notBefore
  cert.validity.notAfter = notAfter
  // forge 对 DN 默认按 Latin1 计长，中文 CN 会产出长度错误的 DER，必须显式 UTF8
  const attrs = [{ name: 'commonName', value: cn, valueTagClass: UTF8_TAG }]
  cert.setSubject(attrs)
  return cert
}

async function ensureCa(dir: string): Promise<{ crt: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey; crtPem: string }> {
  const crtFile = join(dir, 'ca.crt')
  const keyFile = join(dir, 'ca.key')
  try {
    const crtPem = await fsp.readFile(crtFile, 'utf8')
    const keyP = await fsp.readFile(keyFile, 'utf8')
    const crt = pki().certificateFromPem(crtPem)
    const key = pki().privateKeyFromPem(keyP) as forge.pki.rsa.PrivateKey
    // 校验匹配，避免手工删掉一半文件后 CA 与私钥错配
    if ((crt.publicKey as forge.pki.rsa.PublicKey).n.toString(16) === key.n.toString(16)) {
      return { crt, key, crtPem }
    }
  } catch {
    /* 首次生成 */
  }
  const key = forge.pki.rsa.generateKeyPair(2048)
  const cert = makeCert(CA_CN, key)
  cert.setIssuer([{ name: 'commonName', value: CA_CN, valueTagClass: UTF8_TAG }])
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
  ])
  cert.sign(key.privateKey, forge.md.sha256.create())
  const crtPem = certPem(cert)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(crtFile, crtPem)
  await fsp.writeFile(keyFile, keyPem(key.privateKey))
  return { crt: cert, key: key.privateKey, crtPem }
}

function currentSans(ips: string[]): string {
  return ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',')
}

function sansOf(crt: forge.pki.Certificate): string {
  const ext = crt.getExtension('subjectAltName')
  return ext ? String((ext as { value?: unknown }).value ?? '') : ''
}

function certCovers(crt: forge.pki.Certificate, ips: string[]): boolean {
  const sans = sansOf(crt)
  return ips.every((ip) => sans.includes(`IP:${ip}`))
}

export async function ensureServerCert(dataDir: string, ips: string[]): Promise<CertBundle> {
  const dir = join(dataDir, 'certs')
  const ca = await ensureCa(dir)
  const crtFile = join(dir, 'server.crt')
  const keyFile = join(dir, 'server.key')
  const wantSans = currentSans(ips)
  try {
    const oldCrt = pki().certificateFromPem(await fsp.readFile(crtFile, 'utf8'))
    const oldKey = await fsp.readFile(keyFile, 'utf8')
    if (certCovers(oldCrt, ips) && oldCrt.validity.notAfter.getTime() > Date.now() + 30 * 24 * 3600 * 1000) {
      return { caCrt: ca.crtPem, serverCrt: await fsp.readFile(crtFile, 'utf8'), serverKey: oldKey, resigned: false }
    }
  } catch {
    /* 首次签发 */
  }
  const key = forge.pki.rsa.generateKeyPair(2048)
  const cert = makeCert(SERVER_CN, key)
  cert.setIssuer(ca.crt.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', value: wantSans }
  ])
  cert.sign(ca.key, forge.md.sha256.create())
  const sCrt = certPem(cert)
  const sKey = keyPem(key.privateKey)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(crtFile, sCrt)
  await fsp.writeFile(keyFile, sKey)
  return { caCrt: ca.crtPem, serverCrt: sCrt, serverKey: sKey, resigned: true }
}
