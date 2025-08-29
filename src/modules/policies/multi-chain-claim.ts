import {
  type Address,
  type Hex,
  concatHex,
  encodePacked,
  keccak256,
  stringToHex,
} from "viem";

/**
 * MultiChainClaimPolicy encoders and types
 *
 * This module provides utilities to encode the initData for the on-chain
 * MultiChainClaimPolicy (claim-recipient policy). The encoding mirrors the
 * Solidity packing used by the policy contract and ArgPolicyTree library.
 */

/**
 * Single token commitment permitted for a specific source chain.
 */
interface TokenInConfig {
  chainId: bigint;
  token: Address;
  minAmount: bigint;
  maxAmount: bigint;
}

/**
 * Single token distribution permitted for a specific target chain.
 */
interface TokenOutConfig {
  targetChainId: bigint;
  token: Address;
  minAmount: bigint;
  maxAmount: bigint;
}

/**
 * Param comparison operator for ArgPolicy rules. Values mirror on-chain enum ordering.
 */
type ParamCondition =
  | "equal"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "notEqual"
  | "inRange";

/**
 * Single ArgPolicy parameter rule.
 */
interface ParamRule {
  condition: ParamCondition | number;
  /** Bytes offset in the inspected buffer. */
  offset: bigint;
  /** Number of bytes to compare. 0 means 32. */
  length: bigint;
  /** Reference value to compare against (bytes32). */
  ref: Hex;
}

/**
 * ArgPolicy expression tree. packedNodes is an array of 256-bit packed nodes as per ArgPolicyTree.
 */
interface ParamRules {
  rootNodeIndex: bigint;
  rules: readonly ParamRule[];
  packedNodes: readonly bigint[];
}

/**
 * Qualification configuration (EIP-712 typed struct + ArgPolicy param rules).
 */
interface QualificationConfig {
  /**
   * EIP-712 type string (e.g. "TestQualification(uint256 value)") to be hashed as the typehash.
   * If provided, takes precedence over `typehash`.
   */
  typeString?: string;
  /** Pre-computed typehash. Used when `typeString` is not provided. */
  typehash?: Hex;
  /** ArgPolicy rules describing the expected layout/values of the qualification payload. */
  paramRules: ParamRules;
}

/**
 * High-level config for the MultiChainClaimPolicy.
 * Any provided section will be encoded and the corresponding condition bit will be set.
 */
interface MultiChainClaimPolicyConfig {
  /** When enabled, policy requires non-empty executions (targetOps). */
  hasExecutions?: boolean;
  /** Token commitments permitted on source chains. */
  tokenIn?: readonly TokenInConfig[];
  /** Token distributions permitted on the destination chain(s). */
  tokenOut?: readonly TokenOutConfig[];
  /** Qualification rules and type definition. */
  qualification?: QualificationConfig;
}

/** Deployed MultiChainClaimPolicy (Base) */
const MULTICHAIN_CLAIM_POLICY_ADDRESS =
  "0x1cE11C94456574403306b85202D7357EdeD7fB09" as const;

/**
 * Convert a human-friendly condition into the numeric value expected on-chain.
 * Matches the enum used across policies.
 */
function toConditionByte(condition: ParamCondition | number): number {
  if (typeof condition === "number") return condition;
  switch (condition) {
    case "equal":
      return 0;
    case "greaterThan":
      return 1;
    case "lessThan":
      return 2;
    case "greaterThanOrEqual":
      return 3;
    case "lessThanOrEqual":
      return 4;
    case "notEqual":
      return 5;
    case "inRange":
      return 6;
  }
}

/**
 * Encode ArgPolicy ParamRules following ArgPolicyTreeLib packing:
 * abi.encodePacked(rootNodeIndex, rules.length, ...rules, ...packedNodes)
 */
function encodeParamRules(rules: ParamRules): Hex {
  const chunks: Hex[] = [];
  // Header: rootNodeIndex, rules.length
  chunks.push(
    encodePacked(
      ["uint256", "uint256"],
      [rules.rootNodeIndex, BigInt(rules.rules.length)]
    )
  );
  // Rules
  for (const r of rules.rules) {
    chunks.push(
      encodePacked(
        ["uint8", "uint256", "uint256", "bytes32"],
        [toConditionByte(r.condition), r.offset, r.length, r.ref]
      )
    );
  }
  // Packed expression nodes
  for (const node of rules.packedNodes) {
    chunks.push(encodePacked(["uint256"], [node]));
  }
  return concatHex(chunks);
}

/**
 * Encode the initData for MultiChainClaimPolicy.
 * Layout (abi.encodePacked):
 * - uint8 conditionsBitmap
 * - if tokenIn set: uint256 count, then for each: uint256 chainId, address token, uint128 min, uint128 max
 * - if qualification set: bytes32 typehash, then ArgPolicy ParamRules encoding
 * - if tokenOut set: uint256 count, then for each: uint256 targetChainId, address token, uint128 min, uint128 max
 */
function encodeMultiChainClaimPolicy(config: MultiChainClaimPolicyConfig): Hex {
  let conditions = 0;
  if (config.hasExecutions) conditions |= 1 << 0; // bit 0
  if (config.qualification) conditions |= 1 << 1; // bit 1 (as per tests: 2)
  if (config.tokenIn && config.tokenIn.length > 0) conditions |= 1 << 3; // bit 3 (8)
  if (config.tokenOut && config.tokenOut.length > 0) conditions |= 1 << 4; // bit 4 (16)

  const chunks: Hex[] = [];
  // Conditions bitmap
  chunks.push(encodePacked(["uint8"], [conditions]));

  // TokenIn encoding
  if (config.tokenIn && config.tokenIn.length > 0) {
    chunks.push(encodePacked(["uint256"], [BigInt(config.tokenIn.length)]));
    for (const t of config.tokenIn) {
      chunks.push(
        encodePacked(
          ["uint256", "address", "uint128", "uint128"],
          [t.chainId, t.token, t.minAmount, t.maxAmount]
        )
      );
    }
  }

  // Qualification encoding
  if (config.qualification) {
    const q = config.qualification;
    const typehash: Hex = q.typeString
      ? keccak256(stringToHex(q.typeString))
      : (q.typehash as Hex);
    if (!typehash) {
      throw new Error("qualification requires either typeString or typehash");
    }
    chunks.push(encodePacked(["bytes32"], [typehash]));
    chunks.push(encodeParamRules(q.paramRules));
  }

  // TokenOut encoding
  if (config.tokenOut && config.tokenOut.length > 0) {
    chunks.push(encodePacked(["uint256"], [BigInt(config.tokenOut.length)]));
    for (const t of config.tokenOut) {
      chunks.push(
        encodePacked(
          ["uint256", "address", "uint128", "uint128"],
          [t.targetChainId, t.token, t.minAmount, t.maxAmount]
        )
      );
    }
  }

  return concatHex(chunks);
}

/**
 * Helper to build a pre-encoded ERC1271 policy entry consumable by the SDK Session.
 * You must pass the deployed MultiChainClaimPolicy address for your environment.
 */
function createMultiChainClaimErc1271Policy(
  policyAddress: Address,
  config: MultiChainClaimPolicyConfig
): { policy: Address; initData: Hex } {
  return {
    policy: policyAddress,
    initData: encodeMultiChainClaimPolicy(config),
  };
}

export type {
  TokenInConfig,
  TokenOutConfig,
  ParamRule,
  ParamRules,
  QualificationConfig,
  MultiChainClaimPolicyConfig,
};
export {
  encodeMultiChainClaimPolicy,
  createMultiChainClaimErc1271Policy,
  MULTICHAIN_CLAIM_POLICY_ADDRESS,
};
