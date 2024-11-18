import {
  Address,
  createPublicClient,
  formatEther,
  Hex,
  parseEther,
  PublicClient,
  WalletClient,
} from "viem";
import { getBalance } from "viem/actions";

/**
 * Returns the private key as a Hex string
 *
 * Note: This private key should be holding Sepolia ETH and WBTC for the demo to work
 */
export const privateKey = (): Hex => {
  let pk = process.env.ETHEREUM_PRIVATE_KEY;
  if (!pk) {
    throw new Error("ETHEREUM_PRIVATE_KEY is not set");
  }
  return pk.startsWith("0x") ? (pk as Hex) : `0x${pk}`;
};

export const checkBalance = async (
  walletClient: PublicClient,
  address: Address
) => {
  const balance = await getBalance(walletClient, {
    address,
  });

  if (balance < parseEther("0.02")) {
    throw new Error("Balance is too low. Need atleast 0.02 ETH");
  }
};
