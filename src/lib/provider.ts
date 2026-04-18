import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';

export async function initProvider() {
  const rpcs = [CONFIG.rpcUrl, ...CONFIG.rpcFallbacks];

  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      console.log(`Connected to RPC: ${rpc}`);
      return provider;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`RPC failed: ${rpc}`, message);
    }
  }

  throw new Error('Unable to connect to Monad network. Please try again later.');
}
