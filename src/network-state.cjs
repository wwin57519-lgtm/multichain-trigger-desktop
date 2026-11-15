const CONFIG=require('./config.cjs');
function migrate(data,store,kind){
 if(data.schemaVersion===2){CONFIG.forChain(data.selectedChainId);return data;}
 store?.backup?.();
 const records=(data[kind==='owner'?'transactions':'journal']||[]).map(r=>({...r,chainId:r.chainId??8453}));
 const profile=kind==='owner'?Object.fromEntries(Object.entries(data).filter(([k])=>k!=='transactions')):{config:data.config||{},task:data.task||null};
 return {schemaVersion:2,selectedChainId:8453,networks:{8453:profile},[kind==='owner'?'transactions':'journal']:records};
}
module.exports={migrate};
