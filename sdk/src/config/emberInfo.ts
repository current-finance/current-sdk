interface EmberInfo {
    packageId: string;
    protocolConfigId: string;
    vaults: Record<string, VaultInfo>;
}

interface VaultInfo {
    id: string;
    fullCoinType: string;
    underlyingCoinType: string;
}

export const EMBER_INFO: EmberInfo = {
  packageId: '0x4269cb19a1a7938c8263d21c08d98b9324e5985522072ae3d76928650aed809f',
  protocolConfigId: '0x3a515233ab817af082ef31454cee5eb8122b8b7cd586bf6b26ae9b879ee1e565',
  vaults: {
    'eSui': {
      id: '0xfaf4d0ec9b76147c926c0c8b2aba39ea21ec991500c1e3e53b60d447b0e5f655',
      fullCoinType: '66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI',
      underlyingCoinType: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    },
    'eEarn': {
      id: '0x0779d2a4e1a6d3412982404cfe5567aac8cea229f17622c7b72d198b22a22e37',
      fullCoinType: '34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN',
      underlyingCoinType:
                'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    },
    'eThird': {
      id: '0xeadfc1a6ea4915501506945aba6c2acc37c04136a784bafd6ff823a93ef3434a',
      fullCoinType: '89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD',
      underlyingCoinType:
                'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    },
  },

};