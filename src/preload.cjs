const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['network.select', 'app.info','app.openExternal','rpc.test','contract.inspect','wallets.import','wallets.importFile','wallets.list','wallets.copyAddresses','wallets.lock','vault.save','vault.unlock','task.preview','task.start','task.stop','journal.refresh','journal.recover','journal.diagnose']);
contextBridge.exposeInMainWorld('desktop',Object.freeze({
 async invoke(method,args={}){if(!allowed.has(method))throw Error('不支持的操作');const result=await ipcRenderer.invoke('trigger:invoke',method,args);if(!result.ok)throw Error(result.error||'操作失败');return result.value;},
 onEvent(callback){if(typeof callback!=='function')throw Error('需要回调');const listener=(_event,value)=>callback(value);ipcRenderer.on('trigger:event',listener);return()=>ipcRenderer.removeListener('trigger:event',listener);}
}));
