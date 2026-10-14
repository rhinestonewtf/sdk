import type { SettlementCatalog } from '../../src/modules/validators/smart-sessions/settlement/types'

// source: the SDK's bundled tables before RHI-7826 PR 4 (CCTP_CHAINS, OFT_CHAINS,
// ECO_PORTAL/ECO_PROVERS/ECO_STABLECOINS, LZ_MULTICALL/STARGATE_USDC/LZ_CCTP_*),
// lowercased as the orchestrator's /chains serves them. `usdStablecoins` lists
// each chain's Eco stablecoins at their on-chain 6 decimals.
export const SETTLEMENT_CATALOG: SettlementCatalog = {
  1: {
    cctp: {
      domain: 0,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    },
    oft: {
      adapter: '0x6c96de32cea08842dcc4058c14d3aaad7fa41dee',
      eid: 30101,
      token: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: [
        '0xec004ab4870c4e177c66949329dcdb503ce41022',
        '0xcebb7cddba4734c7130bf114a37c2da4c5f3c473',
        '0xe3e4e6f284f1c8e17bafe4268eb98c36886b4d8b',
      ],
      stablecoins: [
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
      ],
    },
    usdStablecoins: [
      {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        symbol: 'USDT',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0xacddac6c77318b615f7f6fb9bb67c6833e9c05f1',
      transferDelegate: '0x72faebf58a62e33c044c37d8d973a961633ea294',
      stargateUsdc: {
        pool: '0xc026395860db2d07ee33e05fe50ed7bd583189c7',
        token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        eid: 30101,
      },
      cctp: {
        domain: 0,
        token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  10: {
    cctp: {
      domain: 2,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    },
    oft: {
      adapter: '0xf03b4d9ac1d5d1e7c4cef54c2a313b9fe051a0ad',
      eid: 30111,
      token: '0x01bff41798a0bcf287b996046ca68b395dbc1071',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: [
        '0xec004ab4870c4e177c66949329dcdb503ce41022',
        '0xe3e4e6f284f1c8e17bafe4268eb98c36886b4d8b',
      ],
      stablecoins: [
        '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        '0x01bff41798a0bcf287b996046ca68b395dbc1071',
        '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
      ],
    },
    usdStablecoins: [
      {
        address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0x01bff41798a0bcf287b996046ca68b395dbc1071',
        symbol: 'USDT0',
        decimals: 6,
      },
      {
        address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
        symbol: 'USDT',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x5528cf58feb8fbfce94f43b33240fffb1312bde3',
      transferDelegate: '0xfbea79d13e6f795a0e1e4b99090f1165a01c7b03',
      stargateUsdc: {
        pool: '0xce8cca271ebc0533920c83d39f417ed6a0abb7d0',
        token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        eid: 30111,
      },
      cctp: {
        domain: 2,
        token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  130: {
    cctp: {
      domain: 10,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x078d782b760474a361dda0af3839290b0ef57ad6',
    },
    oft: {
      adapter: '0xc07be8994d035631c36fb4a89c918cefb2f03ec3',
      eid: 30320,
      token: '0x9151434b16b9763660705744891fa906f660ecc5',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: ['0xec004ab4870c4e177c66949329dcdb503ce41022'],
      stablecoins: [
        '0x078d782b760474a361dda0af3839290b0ef57ad6',
        '0x9151434b16b9763660705744891fa906f660ecc5',
      ],
    },
    usdStablecoins: [
      {
        address: '0x078d782b760474a361dda0af3839290b0ef57ad6',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0x9151434b16b9763660705744891fa906f660ecc5',
        symbol: 'USDT0',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      cctp: {
        domain: 10,
        token: '0x078d782b760474a361dda0af3839290b0ef57ad6',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  137: {
    cctp: {
      domain: 7,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    },
    oft: {
      adapter: '0x6ba10300f0dc58b7a1e4c0e41f5dabb7d7829e13',
      eid: 30109,
      token: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: [
        '0xec004ab4870c4e177c66949329dcdb503ce41022',
        '0xe3e4e6f284f1c8e17bafe4268eb98c36886b4d8b',
      ],
      stablecoins: [
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      ],
    },
    usdStablecoins: [
      {
        address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
        symbol: 'USDT0',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      stargateUsdc: {
        pool: '0x9aa02d4fae7f58b8e8f34c66e756cc734dac7fe4',
        token: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        eid: 30109,
      },
      cctp: {
        domain: 7,
        token: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  143: {
    cctp: {
      domain: 15,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x754704bc059f8c67012fed69bc8a327a5aafb603',
    },
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      cctp: {
        domain: 15,
        token: '0x754704bc059f8c67012fed69bc8a327a5aafb603',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  146: {
    cctp: {
      domain: 13,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x29219dd400f2bf60e5a23d13be72b486d4038894',
    },
    lz: {
      multiCall: '0x6336ed39c2eb15a8cfea73542600eff31ea83353',
      transferDelegate: '0x420c2efa26c972308a543305217399ff65cbdb13',
      stargateUsdc: {
        pool: '0xa272ffe20cffe769cdfc4b63088dcd2c82a2d8f9',
        token: '0x29219dd400f2bf60e5a23d13be72b486d4038894',
        eid: 30332,
      },
      cctp: {
        domain: 13,
        token: '0x29219dd400f2bf60e5a23d13be72b486d4038894',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  196: {
    oft: {
      adapter: '0x94bcca6bdfd6a61817ab0e960bfede4984505554',
      eid: 30274,
      token: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
    },
  },
  999: {
    cctp: {
      domain: 19,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: ['0xec004ab4870c4e177c66949329dcdb503ce41022'],
      stablecoins: [
        '0xb88339cb7199b77e23db6e890353e22632ba630f',
        '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
      ],
    },
    usdStablecoins: [
      {
        address: '0xb88339cb7199b77e23db6e890353e22632ba630f',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
        symbol: 'USDT0',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      cctp: {
        domain: 19,
        token: '0xb88339cb7199b77e23db6e890353e22632ba630f',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  1868: {
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      stargateUsdc: {
        pool: '0x45f1a95a4d3f3836523f5c83673c797f4d4d263b',
        token: '0xba9986d2381edf1da03b0b9c1f8b00dc4aacc369',
        eid: 30340,
      },
    },
    usdStablecoins: [
      {
        address: '0xba9986d2381edf1da03b0b9c1f8b00dc4aacc369',
        symbol: 'USDC',
        decimals: 6,
      },
    ],
  },
  2020: {
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: ['0xcebb7cddba4734c7130bf114a37c2da4c5f3c473'],
      stablecoins: ['0x0b7007c13325c48911f73a2dad5fa5dcbf808adc'],
    },
    usdStablecoins: [
      {
        address: '0x0b7007c13325c48911f73a2dad5fa5dcbf808adc',
        symbol: 'USDC',
        decimals: 6,
      },
    ],
  },
  5042: {
    cctp: {
      domain: 26,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x3600000000000000000000000000000000000000',
    },
  },
  8453: {
    cctp: {
      domain: 6,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: [
        '0xec004ab4870c4e177c66949329dcdb503ce41022',
        '0xcebb7cddba4734c7130bf114a37c2da4c5f3c473',
        '0xe3e4e6f284f1c8e17bafe4268eb98c36886b4d8b',
      ],
      stablecoins: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
    },
    usdStablecoins: [
      {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        symbol: 'USDC',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x7e07a9148e9149e430c6412b79a675028595ff1f',
      transferDelegate: '0x8eca03175fd5ac62fb6f4ecbb9a95d13dcdcb4f8',
      stargateUsdc: {
        pool: '0x27a16dc786820b16e5c9028b75b99f6f604b5d26',
        token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        eid: 30184,
      },
      cctp: {
        domain: 6,
        token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  9745: {
    oft: {
      adapter: '0x02ca37966753bdddf11216b73b16c1de756a7cf9',
      eid: 30383,
      token: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: ['0xec004ab4870c4e177c66949329dcdb503ce41022'],
      stablecoins: [
        '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
        '0x2d661c89d812261039af9764eceaaee884f5f67f',
      ],
    },
    usdStablecoins: [
      {
        address: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
        symbol: 'USDT0',
        decimals: 6,
      },
      {
        address: '0x2d661c89d812261039af9764eceaaee884f5f67f',
        symbol: 'USDC',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      cctp: {
        domain: 33,
        token: '0x2d661c89d812261039af9764eceaaee884f5f67f',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
        feeless: true,
      },
    },
  },
  42161: {
    cctp: {
      domain: 3,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    },
    oft: {
      adapter: '0x14e4a1b13bf7f943c8ff7c51fb60fa964a298d92',
      eid: 30110,
      token: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    },
    eco: {
      portal: '0xec000064576f9c95a8623bc0eff3db6d296ea6df',
      provers: [
        '0xec004ab4870c4e177c66949329dcdb503ce41022',
        '0xe3e4e6f284f1c8e17bafe4268eb98c36886b4d8b',
      ],
      stablecoins: [
        '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      ],
    },
    usdStablecoins: [
      {
        address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
        symbol: 'USDT0',
        decimals: 6,
      },
    ],
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      stargateUsdc: {
        pool: '0xe8cdf27acd73a434d661c84887215f7598e7d0d3',
        token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        eid: 30110,
      },
      cctp: {
        domain: 3,
        token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  43114: {
    cctp: {
      domain: 1,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    },
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      stargateUsdc: {
        pool: '0x5634c4a5fed09819e3c46d86a965dd9447d86e47',
        token: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
        eid: 30106,
      },
      cctp: {
        domain: 1,
        token: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  57073: {
    cctp: {
      domain: 21,
      tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
      usdc: '0x2d270e6886d130d724215a266106e6832161eaed',
    },
    oft: {
      adapter: '0x1cb6de532588fca4a21b7209de7c456af8434a65',
      eid: 30339,
      token: '0x0200c29006150606b650577bbe7b6248f58470c1',
    },
    lz: {
      multiCall: '0x8e60b7b64b63cd56b18ebcecadcb79b04919286e',
      transferDelegate: '0x60fccb9b58d5e806ca5cb8bfce721c2274609de4',
      cctp: {
        domain: 21,
        token: '0x2d270e6886d130d724215a266106e6832161eaed',
        feeReceiver: '0xb324de4add083b74856082ed2ea0b8b6f3864827',
      },
    },
  },
  84532: {
    cctp: {
      domain: 6,
      tokenMessenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    },
  },
  421614: {
    cctp: {
      domain: 3,
      tokenMessenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      usdc: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    },
  },
  11155111: {
    cctp: {
      domain: 0,
      tokenMessenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      usdc: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    },
  },
  11155420: {
    cctp: {
      domain: 2,
      tokenMessenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      usdc: '0x5fd84259d66cd46123540766be93dfe6d43130d7',
    },
  },
}
