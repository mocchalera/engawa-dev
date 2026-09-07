/** Parse an explicit own-input backup. This module never sends requests or restores fetched data. */
const operations = new Set(['profile','post','pin','deletePost','task','taskUpdate','deleteTask','capture','forget','share','object','water','deleteObject','ambience','play','resetGame']);
export function parseRecovery(raw, origin, actor, existingDrafts = new Map(), existingPending = new Map()) {
  const fail = () => { throw new Error('退避データの形式・本人・元のサイト・既存の入力を確認してください。'); };
  if (typeof raw !== 'string' || raw.length > 1_048_576 || !actor) return fail();
  let value; try { value=JSON.parse(raw); } catch { return fail(); }
  if (!value || Object.keys(value).some(k=>!['format','origin','actor','drafts','pending','form'].includes(k)) || value.format!=='engawa-town-own-input/v1' || value.origin!==origin || value.actor!==actor || !Array.isArray(value.drafts) || !Array.isArray(value.pending) || value.drafts.length>100 || value.pending.length>100) return fail();
  const drafts=new Map(existingDrafts),pending=new Map(existingPending),safe=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
  for (const item of value.drafts) {
    if (!Array.isArray(item)||item.length!==2||typeof item[0]!=='string'||!item[0].startsWith(actor+':')||typeof item[1]!=='string'||item[1].length>500) return fail();
    const previous=drafts.get(item[0]);if(previous&&previous!==item[1])return fail();drafts.set(...item);
  }
  for(const item of value.pending) {
    if(!Array.isArray(item)||item.length!==2) return fail();const [key,record]=item,input=record?.input;
    if(typeof key!=='string'||record?.owner!==actor||!input||!operations.has(input.op)||!safe(input.requestId)||key!==`${actor}:${input.roomId||''}`||JSON.stringify(input).length>65536) return fail();
    if(input.roomId&&!safe(input.roomId))return fail();
    if(pending.has(key)&&JSON.stringify(pending.get(key))!==JSON.stringify(record))return fail();
    pending.set(key,structuredClone(record));
  }
  const form=value.form;
  if(form!=null&&(!['profile','post','task','object'].includes(form.kind)||typeof form.roomId!=='string'||!form.values||Object.values(form.values).some(v=>typeof v!=='string'||v.length>8000)))return fail();
  return {drafts,pending,form:form?structuredClone(form):null};
}
