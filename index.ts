import { MemoryStorage, Siwe, Url } from "@gardenfi/utils";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  EvmRelay,
  Garden,
  Quote,
  SecretManager,
  SwapParams,
} from "@gardenfi/core";
import {
  BitcoinNetwork,
  BitcoinProvider,
  BitcoinWallet,
} from "@catalogfi/wallets";
import { Asset, SupportedAssets } from "@gardenfi/orderbook";
import { checkBalance, privateKey } from "./privateKey";

const constructOrderpair = (fromAsset: Asset, toAsset: Asset) =>
  `${fromAsset.chain}:${fromAsset.atomicSwapAddress}::${toAsset.chain}:${toAsset.atomicSwapAddress}`;

const orderBookApi = "https://orderbook.garden.finance";
const quoteApi = "https://price.garden.finance";
const bitcoinProviderApi = "https://mempool.space/testnet4/api";

console.log("Starting...\n");

const account = privateKeyToAccount(privateKey());
const ethereumWalletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(),
});

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

console.log("Checking ETH balance...\n");
await checkBalance(publicClient, ethereumWalletClient.account.address);

console.log(
  "Make sure you have atleast 0.01 WBTC (one swap) in your wallet.\n\n"
);

// This is used to authenticate with the orderbook
const auth = new Siwe(new Url(orderBookApi), ethereumWalletClient, {
  store: new MemoryStorage(),
});

// This is used to get the quote
const quote = new Quote(quoteApi);

// SecretManager is responsible for generating the master private key and then deriving
// secrets from it for the orders
const result = await SecretManager.fromWalletClient(ethereumWalletClient);
if (result.error) {
  throw new Error(result.error);
}
const secretManager = result.val;

// This is used to interact with the Bitcoin network
const bitcoinProvider = new BitcoinProvider(
  BitcoinNetwork.Testnet,
  bitcoinProviderApi
);
const btcWallet = BitcoinWallet.fromPrivateKey(
  secretManager.getMasterPrivKey(),
  bitcoinProvider
);

// The core logic to create orders and then execute them
const garden = new Garden({
  orderbookURl: orderBookApi,
  secretManager,
  quote,
  auth,
  wallets: {
    evmWallet: ethereumWalletClient,
    btcWallet,
  },
});

// We represent assets as {chain_name}:{atomic_swap_contract_addr}
// 0x3c6a17b8cd92976d1d91e491c93c98cd81998265 is the atomic swap address for WBTC on Sepolia
// Try printing out the SupportedAssets object to see the other assets you can use
const orderConfig = {
  fromAsset:
    SupportedAssets.testnet
      .ethereum_sepolia_0x3c6a17b8cd92976d1d91e491c93c98cd81998265,
  toAsset: SupportedAssets.testnet.bitcoin_testnet_primary,
  sendAmount: "1000000", // 0.01 Bitcoin
};

const orderPair = constructOrderpair(
  orderConfig.fromAsset,
  orderConfig.toAsset
);

// Get the quote for the send amount and order pair
const quoteResult = await quote.getQuote(orderPair, +orderConfig.sendAmount);
if (quoteResult.error) {
  throw new Error(quoteResult.error);
}

// lets take the first quote
const firstQuote = Object.entries(quoteResult.val.quotes)[0];
// firstQuote[0] is the strategy id
// firstQuote[1] is the receive amount

let swapParams: SwapParams = {
  ...orderConfig,
  receiveAmount: firstQuote[1],
  additionalData: {
    strategyId: firstQuote[0],
    // this is where the btc will be sent to
    btcAddress: await btcWallet.getAddress(),
  },
};

console.log("Creating an order...\n");

// This creates the order on chain and then returns the matched order
const swapResult = await garden.swap(swapParams);
if (swapResult.error) {
  throw new Error(swapResult.error);
}

console.log("Order created with id", swapResult.val.create_order.create_id);
console.log(
  `use https://orderbook.garden.finance/orders/id/matched/${swapResult.val.create_order.create_id} for more details`
);

console.log("--------------------------------\n\n");

console.log("Swapping... This might take a while\n");

garden.on("error", (order, error) => {
  console.log(order.create_order.create_id, error);
});

garden.on("success", (order, action, txHash) => {
  console.log("Successfully swapped from wbtc on sepolia to btc", txHash);
  console.log("Visit https://mempool.space/testnet4/tx/" + txHash);

  // A note on bitcoin redeems:
  // As long as the bitcoin tx is not mined in the above url, it is recommended to keep the garden running.
  // Garden can resubmit the redeem tx if necessary for various reasons.
  // If the runner is stopped, the next time it is started, it will check the status of the order
  // and then resubmit the redeem if necessary.
});

// This is necessary to execute redeems or refunds automatically
// basically polls the orderbook for the status of the orders
// and then redeems or refunds accordingly
await garden.execute();

// For gasless swaps, we can use the relay service to initiate the swap
const evmRelay = new EvmRelay(swapResult.val, orderBookApi, auth);

// Initiate the swap (for the first time, some eth is required to approve the token)
// All the subsequent swaps are gasless
// Common error here is transfer amount exceeds balance, meaning you dont have token in your wallet
const initRes = await evmRelay.init(ethereumWalletClient);
if (initRes.error) {
  console.log(ethereumWalletClient.account.address);
  throw new Error(initRes.error);
}

// Wait for the swap to be completed and ctrl+c to stop the script
await new Promise((resolve) => setTimeout(resolve, 10000000000));
