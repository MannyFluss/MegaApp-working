// Lossless JSON value interning. Numbers stay numbers; no quantization, model,
// stroke simplification, or inferred actions. References are single-item arrays.
export function createValuePool({ cacheObjects = false } = {}) {
  const nodes = new Map(), keys = new Map(), frozen = new WeakMap();
  let next = 0, bytes = 0;
  const ref = token => Array.isArray(token);
  function retain(token) { if (ref(token)) nodes.get(token[0]).uses++; }
  function release(token) {
    if (!ref(token)) return;
    const node = nodes.get(token[0]);
    if (--node.uses) return;
    nodes.delete(token[0]); keys.delete(node.key); bytes -= node.bytes;
    for (const child of node.children) release(child);
  }
  function encode(value) {
    if (value === null || typeof value !== 'object') return value;
    const cached = frozen.get(value);
    if (cached && nodes.has(cached[0])) return cached;
    let entry, children;
    if (Array.isArray(value)) {
      children = value.map(encode); entry = ['a', children];
    } else if (Object.keys(value).join(',') === 'x,y,t,pressure' && Object.values(value).every(v => typeof v === 'number' && Number.isFinite(v))) {
      children = []; entry = ['p', [value.x, value.y, value.t, value.pressure]];
    } else {
      const pairs = Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k,encode(v)]);
      children = pairs.map(([,v]) => v); entry = ['o', pairs];
    }
    const key = JSON.stringify(entry);
    let id = keys.get(key);
    if (id === undefined) {
      id = next++; const size = new TextEncoder().encode(key).length + 8;
      nodes.set(id, { entry, key, children, bytes: size, uses: 0 }); keys.set(key,id); bytes += size;
      for (const child of children) retain(child);
    }
    const token = [id];
    // Only deeply frozen JSON is cached by identity. Mutable caller state is
    // always walked again so a later edit cannot change an earlier observation.
    if (cacheObjects || Object.isFrozen(value) && Object.values(value).every(v => !v || typeof v !== 'object' || frozen.has(v))) frozen.set(value,token);
    return token;
  }
  function decode(token, cache = new Map()) {
    if (!ref(token)) return token;
    if (cache.has(token[0])) return cache.get(token[0]);
    const [kind,data] = nodes.get(token[0]).entry;
    const value = kind === 'p' ? {x:data[0],y:data[1],t:data[2],pressure:data[3]}
      : kind === 'a' ? data.map(v => decode(v,cache)) : Object.fromEntries(data.map(([k,v]) => [k,decode(v,cache)]));
    cache.set(token[0],value); return value;
  }
  function exportValues() {
    const ids = [...nodes.keys()], remap = new Map(ids.map((id,i)=>[id,i]));
    const token = v => ref(v) ? [remap.get(v[0])] : v;
    const values = ids.map(id => { const [kind,data] = nodes.get(id).entry; return [kind,kind==='p'?data:kind==='a'?data.map(token):data.map(([k,v])=>[k,token(v)])]; });
    return { values, token };
  }
  return { encode, retain, release, decode, exportValues, get bytes(){return bytes;}, get size(){return nodes.size;} };
}
export function encodeMoment(moment) {
  if (moment.version === 2) return moment;
  const pool = createValuePool({ cacheObjects: true });
  const { context, baseline, events, ...metadata } = moment;
  const rows = events.map(({context,...event}) => ({...event,...(context===undefined?{}:{context:pool.encode(context)})}));
  const refs = {};
  if (context !== undefined) refs.context = pool.encode(context);
  if (baseline !== undefined) refs.baseline = pool.encode(baseline);
  const {values,token} = pool.exportValues();
  return {...metadata,version:2,encoding:'interned-json-v1',values,
    events:rows.map(row=>({...row,...(row.context===undefined?{}:{context:token(row.context)})})),
    ...Object.fromEntries(Object.entries(refs).map(([k,v])=>[k,token(v)]))};
}
// Self-contained: the same decoder is embedded in standalone replay exports.
export function decodeMoment(moment) {
  if (moment?.version !== 2) return moment;
  if (moment.format !== 'megaapp-moment' || moment.encoding !== 'interned-json-v1' || !Array.isArray(moment.values) || moment.values.length > 250000 || !Array.isArray(moment.events) || moment.events.length > 50000) throw new Error('Invalid compact moment.');
  const {values,encoding,events,...metadata} = moment;
  const decoded = [], sizes = [];
  let work = 0;
  function token(value, index = values.length) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (!Array.isArray(value) || value.length !== 1 || !Number.isInteger(value[0]) || value[0]<0 || value[0]>=index) throw new Error('Invalid compact moment reference.');
    return decoded[value[0]];
  }
  // Each node refers only to preceding nodes: cycles and forward references
  // are rejected. Bound expanded size too, to reject tiny expansion bombs.
  function size(value) { return Array.isArray(value) ? sizes[value[0]] : JSON.stringify(value).length; }
  for (let i=0;i<values.length;i++) {
    const entry=values[i];
    if (!Array.isArray(entry) || entry.length!==2 || !Array.isArray(entry[1])) throw new Error('Invalid compact moment value.');
    const [kind,data]=entry;
    let result, length;
    if (kind==='p') {
      if(data.length!==4 || data.some(v=>!Number.isFinite(v)))throw new Error('Invalid compact ink point.');
      result={x:data[0],y:data[1],t:data[2],pressure:data[3]};length=JSON.stringify(result).length;
    } else if (kind==='a') {
      result=data.map(v=>token(v,i));length=2+data.reduce((n,v)=>n+size(v)+1,0);
    } else if (kind==='o') {
      const seen=new Set();const pairs=data.map(pair=>{
        if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||seen.has(pair[0]))throw new Error('Invalid compact object.');
        seen.add(pair[0]);return [pair[0],token(pair[1],i)];
      });result=Object.fromEntries(pairs);length=2+data.reduce((n,[k,v])=>n+JSON.stringify(k).length+size(v)+2,0);
    } else throw new Error('Unknown compact moment value.');
    if(length>20000000 || (work+=data.length)>2000000)throw new Error('Compact moment expansion exceeds its limit.');
    decoded.push(result);sizes.push(length);
  }
  // Repeated event roots share decoded values. Counting their expanded JSON
  // repeatedly would reject a legitimate long recording of unchanged ink.
  const context = v => token(v);
  return {...metadata,version:1,events:events.map(event=>({...event,...(event.context===undefined?{}:{context:context(event.context)})})),
    ...(moment.context===undefined?{}:{context:context(moment.context)}),...(moment.baseline===undefined?{}:{baseline:context(moment.baseline)})};
}
export function freezeJSON(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freezeJSON(child); Object.freeze(value); }
  return value;
}
