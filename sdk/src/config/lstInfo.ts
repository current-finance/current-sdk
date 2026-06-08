export const SUI_SYSTEM_STATE_ID = '0x5';

interface LstInfo {
    packageId: string;
    lstPackageId: string;
    liquidStakingInfoId: string;
    extraIds: Record<string, string>;
}

export const LST_INFO: Record<string, LstInfo> = {
  'stSui': {
    packageId: '0x059f94b85c07eb74d2847f8255d8cc0a67c9a8dcc039eabf9f8b9e23a0de2700',
    lstPackageId: '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55',
    liquidStakingInfoId: '0x1adb343ab351458e151bc392fbf1558b3332467f23bda45ae67cd355a57fd5f5',
    extraIds: {},
  },
  'springSui': {
    packageId: '0x47c4b62aed92c5ae308ecd00253b64b3568ad97e6fb11e54b3d1ac5ed7be19ab',
    lstPackageId: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf',
    liquidStakingInfoId: '0x15eda7330c8f99c30e430b4d82fd7ab2af3ead4ae17046fcb224aa9bad394f6b',
    extraIds: {},
  },
  'vSui': {
    packageId: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',
    lstPackageId: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55',
    liquidStakingInfoId: '0x2d914e23d82fedef1b5f56a32d5c64bdcc3087ccfea2b4d6ea51a71f587840e5',
    extraIds: {
      metadataId: '0x680cd26af32b2bde8d3361e804c53ec1d1cfe24c7f039eb7f549e8dfde389a60',
    },
  },
  'haSui': {
    packageId: '0x19e6ea7f5ced4f090e20da794cc80349a03e638940ddb95155a4e301f5f4967c',
    lstPackageId: '', // not used by hasui
    liquidStakingInfoId: '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca',
    extraIds: {},
  },
  'afSui': {
    packageId: '0x1575034d2729907aefca1ac757d6ccfcd3fc7e9e77927523c06007d8353ad836',
    lstPackageId: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc',
    liquidStakingInfoId: '0x2f8f6d5da7f13ea37daa397724280483ed062769813b6f31e9788e59cc88994d',
    extraIds: {
      vaultState: '0x55486449e41d89cfbdb20e005c1c5c1007858ad5b4d5d7c047d2b3b592fe8791',
      safe: '0xeb685899830dd5837b47007809c76d91a098d52aabbf61e8ac467c59e5cc4610',
      referralVault: '0x4ce9a19b594599536c53edb25d22532f82f18038dc8ef618afd00fbbfb9845ef',
      treasury: '0xd2b95022244757b0ab9f74e2ee2fb2c3bf29dce5590fa6993a85d64bd219d7e8',
      defaultStakeValidator:
                '0x4fffd0005522be4bc029724c7f0f6ed7093a6bf3a09b90e62f61dc15181e1a3e',
    },
  },
};
