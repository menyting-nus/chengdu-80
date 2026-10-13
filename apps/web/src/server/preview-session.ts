import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { findApp, type Access } from "./repository";
import { sourceHash } from "./runtime";
import { settings } from "./settings";

const processKey = randomBytes(32);
const grants = new Map<string, PreviewGrant>();
const lifetime = 20 * 60_000;
type PreviewGrant = {
  id: string;
  appId: string;
  releaseId: string;
  ownerId: string;
  expiresAt: number;
  nonce: string;
  origin: string;
  access: Access;
};

async function signature(grant: PreviewGrant) {
  const config = await settings();
  const secret = config.CD80_PREVIEW_SIGNING_KEY ?? config.PLATFORM_INTERNAL_KEY ?? processKey;
  // The opaque URL authenticates these server-held claims. Auth credentials
  // remain in memory and never appear in the URL or generated application.
  const { access: _access, ...claims } = grant;
  return createHmac("sha256", secret).update(JSON.stringify(claims)).digest("base64url");
}

export async function verifiedPreviewRelease(access: Access, appId: string, releaseId: string) {
  const app = await findApp(access, appId);
  if (app.ownerId !== access.ownerId) throw new Error("Application not found");
  const release = [app.current, app.preview].find((item) => item?.id === releaseId);
  if (
    !release?.verification.passed ||
    release.verification.sourceHash !== (await sourceHash(release.bundle))
  )
    throw new Error("A verified, unchanged release is required");
  return release;
}

export async function createPreviewSession(
  access: Access,
  appId: string,
  releaseId: string,
  nonce: string,
  origin: string,
) {
  await verifiedPreviewRelease(access, appId, releaseId);
  for (const [id, grant] of grants) if (grant.expiresAt < Date.now()) grants.delete(id);
  while (grants.size >= 64) {
    const oldest = grants.keys().next().value;
    if (oldest) grants.delete(oldest);
  }
  const grant: PreviewGrant = {
    id: randomBytes(16).toString("hex"),
    appId,
    releaseId,
    ownerId: access.ownerId,
    expiresAt: Date.now() + lifetime,
    nonce,
    origin,
    access,
  };
  grants.set(grant.id, grant);
  const token = `${grant.id}.${await signature(grant)}`;
  return { url: `/api/app-preview/${token}/`, expiresAt: grant.expiresAt };
}

export async function resolvePreviewSession(token: string, origin: string) {
  if (!/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid preview session");
  const [id, supplied] = token.split(".");
  const grant = grants.get(id);
  if (!grant || grant.expiresAt < Date.now() || grant.origin !== origin)
    throw new Error("Preview session expired");
  const expected = await signature(grant);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)))
    throw new Error("Invalid preview session");
  const release = await verifiedPreviewRelease(grant.access, grant.appId, grant.releaseId);
  return { grant, release, basePath: `/api/app-preview/${token}/` };
}

export function previewBridge(nonce: string) {
  return `const report=message=>parent.postMessage({channel:'cd80',nonce:'${nonce}',log:{message:String(message)}},'*');const originalError=console.error.bind(console);console.error=(...args)=>{originalError(...args);report(args.map(value=>value instanceof Error?value.message:String(value)).join(' '));};window.addEventListener('error',e=>report(e.message));window.addEventListener('unhandledrejection',e=>report(e.reason instanceof Error?e.reason.message:e.reason));const pending=new Map();let count=0;window.cd80={call(capability,input={}){return new Promise((resolve,reject)=>{const id=String(++count);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Capability request timed out'));},100000);pending.set(id,{resolve,reject,timer});parent.postMessage({channel:'cd80',nonce:'${nonce}',id,capability,input},'*');});},ready(){parent.postMessage({channel:'cd80',nonce:'${nonce}',ready:true},'*');}};window.addEventListener('message',e=>{const m=e.data;if(e.source!==parent||!m||m.channel!=='cd80-result'||m.nonce!=='${nonce}')return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);});`;
}
