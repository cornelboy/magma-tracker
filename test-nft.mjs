import { ethers } from 'ethers';

async function main() {
  const rpcUrls = [
    'https://testnet-rpc.monad.xyz/'
  ];
  
  let provider = null;
  let activeRpc = '';
  
  for (const rpc of rpcUrls) {
    console.log(`Trying RPC: ${rpc}`);
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      const block = await p.getBlockNumber();
      console.log(`  Connected! Current block: ${block}`);
      provider = p;
      activeRpc = rpc;
      break;
    } catch (e) {
      console.log(`  Failed: ${e.message.substring(0, 100)}...`);
    }
  }

  if (!provider) {
    console.log("Could not connect to any RPC.");
    return;
  }

  const config = {
    SCALE: '0x427D16455784e2587088fe333024B870126A0c72',
    ROARRR: '0xcbdFaD1bfb6A4414DD4D84B7A6420dc43683deB0'
  };

  const testAbi = [
    "function name() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function walletOfOwner(address) view returns (uint256[])",
    "function tokensOfOwner(address) view returns (uint256[])"
  ];

  for (const [name, address] of Object.entries(config)) {
    console.log(`\n=== Testing ${name} Contract: ${address} ===`);
    const contract = new ethers.Contract(address, testAbi, provider);

    try {
      const cName = await contract.name();
      console.log(`Contract verified: ${cName}`);
    } catch (e) {
      console.log(`Failed to call name() - the contract might not exist on this network.`);
      continue;
    }

    const testAddress = "0x0000000000000000000000000000000000000001";
    
    // Test walletOfOwner
    try {
      await contract.walletOfOwner(testAddress);
      console.log(`✅ 'walletOfOwner(address)' IS supported!`);
    } catch(e) { 
      // It might throw due to 0 address, let's look at the error
      if (e.message.includes('revert')) {
         console.log(`✅ 'walletOfOwner(address)' IS supported! (reverted because testAddress has no NFTs)`);
      } else {
         console.log(`❌ 'walletOfOwner(address)' unsupported`); 
      }
    }

    // Test tokensOfOwner
    try {
      await contract.tokensOfOwner(testAddress);
      console.log(`✅ 'tokensOfOwner(address)' IS supported!`);
    } catch(e) { 
      if (e.message.includes('revert')) {
         console.log(`✅ 'tokensOfOwner(address)' IS supported!`);
      } else {
         console.log(`❌ 'tokensOfOwner(address)' unsupported`); 
      }
    }

    // Test getLogs
    console.log(`Testing getLogs(0, 'latest') for Transfer events...`);
    try {
      const eventParams = [ethers.id("Transfer(address,address,uint256)")];
      const logs = await provider.getLogs({
        address: address,
        topics: eventParams,
        fromBlock: 0,
        toBlock: 'latest'
      });
      console.log(`✅ getLogs succeeded with ${logs.length} logs!`);
    } catch(e) {
      console.log(`❌ getLogs failed: ${e.message.substring(0, 150)}`);
    }
  }
}

main().catch(console.error);
