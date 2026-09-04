/**
 * Minimal ABIs — only the functions this app calls.
 *
 * Hand-written rather than generated from Foundry's artifacts: the app needs
 * six functions, and importing whole build outputs would drag the entire
 * contract surface into the bundle for no benefit. The types below are
 * checked against the deployed contracts by lib/chain/chain.test.ts, which
 * hashes each signature and compares it to the ABI Foundry produced.
 */

export const entityRegistryAbi = [
  {
    type: "function",
    name: "registerEntityFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "entity", type: "address" },
      { name: "entityType", type: "uint8" },
      { name: "metadataURI", type: "string" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "entity", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "signer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const assetRegistryAbi = [
  {
    type: "function",
    name: "registerAssetFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "assetType", type: "string" },
      { name: "capabilities", type: "uint32" },
      { name: "metadataURI", type: "string" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "assetsOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "signer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "MODALITY_RGB", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "MODALITY_IMU", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
] as const;

export const episodeRegistryAbi = [
  {
    type: "function",
    name: "submitEpisodeFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contributor", type: "address" },
      { name: "assetId", type: "uint256" },
      { name: "bountyId", type: "bytes32" },
      { name: "manifestHash", type: "bytes32" },
      { name: "storageURI", type: "string" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recordValidation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "episodeId", type: "uint256" },
      { name: "score", type: "uint16" },
      { name: "trustLevel", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "episodeByManifest",
    stateMutability: "view",
    inputs: [{ name: "manifestHash", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "signer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "EpisodeSubmitted",
    inputs: [
      { name: "episodeId", type: "uint256", indexed: true },
      { name: "assetId", type: "uint256", indexed: true },
      { name: "contributor", type: "address", indexed: true },
      { name: "manifestHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

/**
 * EIP-712 types, matching the typehash strings in Relayable's subclasses.
 *
 * Field order is load-bearing: EIP-712 hashes the encoded struct in
 * declaration order, so reordering these silently produces a signature that
 * recovers to the wrong address and reverts as InvalidSignature.
 */
export const REGISTER_ENTITY_TYPES = {
  RegisterEntity: [
    { name: "entityType", type: "uint8" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const REGISTER_ASSET_TYPES = {
  RegisterAsset: [
    { name: "assetType", type: "string" },
    { name: "capabilities", type: "uint32" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const SUBMIT_EPISODE_TYPES = {
  SubmitEpisode: [
    { name: "assetId", type: "uint256" },
    { name: "bountyId", type: "bytes32" },
    { name: "manifestHash", type: "bytes32" },
    { name: "storageURI", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Each contract names its own EIP-712 domain so signatures cannot cross. */
export const DOMAIN_NAMES = {
  entity: "WorldModEntityRegistry",
  asset: "WorldModAssetRegistry",
  episode: "WorldModEpisodeRegistry",
} as const;
