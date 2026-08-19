import { TypeName } from '../market-types';

/// The environment of the protocol. This is different from Network parameter which is 
/// a sui blockchain network. The develop contracts could live in sui mainnet.
export enum Env {
  Develop,
  Production,
}

export interface ReserveIds {
  reserveId: string;
  balanceId: string;
}

export interface EmodeGroup {
  emodeId: number;
  name: string;
  assets: TypeName[];
}

export interface MarketWithEmodes {
  name: string;
  type: string; // Full Move type with package ID (e.g., "0x123...::market_type::MainMarket")
  objectId: string; // Market object ID
  emodeGroups: EmodeGroup[];
  // Static dynamic-field IDs for this market's reserves, keyed by coin type.
  // Each entry carries both the outer Field wrapper in the reserves table
  // (reserveId) and the ReserveBalance child field (balanceId). Populated only
  // for stable deployments (see `getStaticReserveIds`); when present, callers
  // can skip every discovery RPC and read reserves + balances in one
  // multiGetObjects. Must be re-verified against chain state after any
  // redeploy.
  reserveIds: Record<TypeName, ReserveIds>;
}

export interface LeverageMarket {
  lendingMarketType: TypeName;
  lendingMarketId: string;
  lendingMarketName: string;
  objectId: string; // leverage market object ID
  emodeId: number; // emode group ID for this leverage market
}

export interface NetworkConfig {
  flpPackageId: string;
  flpAppId: string;
  xOraclePackageId: string;
  protocolPackageId: string;
  leveragePackageId: string;
  coinDecimalsRegistryId: string;
  xOracleId: string;
  markets: MarketWithEmodes[];
  leverageMarkets: LeverageMarket[];
  protocolAppId: string;
  leverageAppId: string;
  xOracle: { [key: TypeName]: OracleAssetConfig },
}

/** x_oracle source ids (see `x_oracle::asset`). Pyth Pro is always the primary here. */
export const SOURCE_ID = {
  PYTH: 1,
  STORK: 2,
  ADMIN_REF: 255,
} as const;


/** One asset's oracle wiring, as stored in `config/oracle-asset-config.json`. */
export interface OracleAssetConfig {
  config: {
    baseTokenId: number;
    primarySourceId: number;
    checkSourceId: number;
    lowerBoundBps: number;
    upperBoundBps: number;
    maxUpdateTimeGapMs: number;
  };
  /** Set iff `config.checkSourceId === SOURCE_ID.PYTH || config.primarySourceId === SOURCE_ID.PYTH`.. */
  pyth: {
    /** Pyth Lazer feed id. */
    feedId: number;
    /** Lazer delivery channel id: 1=real_time, 2=50ms, 3=200ms, 4=1000ms. */
    channelId: number;
    minPublishers: number;
    spotConfBps: number;
    emaConfBps: number;
  } | null,
  /** Set iff `config.checkSourceId === SOURCE_ID.STORK || config.primarySourceId === SOURCE_ID.STORK`.. */
  stork: { feedName: string; emaFeedName: string } | null;
}

export const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
  mainnet: {
    'flpPackageId': '0xfbb9f951e243560e46ba65aed64105e4bc7c5e874b35fabf23259bec4458eccf',
    'flpAppId': '0x2bb9fb6913c1a8061a21876016b464077051c2914dd8bcd4d6cdb05a5884cc45',
    'protocolPackageId': '0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70',
    'leveragePackageId': '0xaab00c7753c4843716981350f869af1d0e57de360d3f5f5a3da5a52cd2aade47',
    'xOraclePackageId': '0xec244262968307f6b502f28bbf03aed94140e7467d1638b01a29ec5cc43fd769',
    'coinDecimalsRegistryId': '0x53785858526d8ed3826cfc245b0fd53f16179036f38fc024c3851ef07b1538d7',
    'xOracleId': '0x7aca2c7d1aa11640f8de16c4b6a2c3a672eb69872eddd59ed22a073908840e1a',
    'leverageAppId': '0xbfcd97b3f7219373c6f0a4cf556ab2e3a92d7879ab94c88efdd355a2bf80bc27',
    'markets': [
      {
        'name': 'MainMarket',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'objectId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              '3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
              'f325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
              'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
              '83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
              '549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
              'd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
              '960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
              'bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
              'f16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
              '876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC',
              'e14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB',
              'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
              '8f2b5eb696ed88b71fea398d330bccfa52f6e2a5a8e1ac6180fcb25c6de42ebc::coin::COIN',
              '7a479e7a6e75323ac9125656a9ca795e11ea42165ac4206af44d1b66e9563be9::svbtc::SVBTC',
            ],
          },
          {
            'emodeId': 1,
            'name': 'hasuisui',
            'assets': [
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              'bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
            ],
          },
          {
            'emodeId': 2,
            'name': 'stsuisui',
            'assets': [
              'd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 3,
            'name': 'afsuisui',
            'assets': [
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              'f325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
            ],
          },
          {
            'emodeId': 4,
            'name': 'vsuisui',
            'assets': [
              '549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 5,
            'name': 'springsuisui',
            'assets': [
              '83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 6,
            'name': 'usdysui',
            'assets': [
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              '960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
            ],
          },
          {
            'emodeId': 7,
            'name': 'usdystablecoin',
            'assets': [
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
              '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              'e14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB',
              '960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
            ],
          },
          {
            'emodeId': 8,
            'name': 'suiusdc',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 9,
            'name': 'suiusdsui',
            'assets': [
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
            ],
          },
          {
            'emodeId': 10,
            'name': 'usdsuiusdc',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
            ],
          },
          {
            'emodeId': 11,
            'name': 'usdcusdsui',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
            ],
          },
          {
            'emodeId': 12,
            'name': 'whiteliststablecoin',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
              '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
            ],
          },
          {
            'emodeId': 13,
            'name': 'usdcsui',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 14,
            'name': 'svbtcloop',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '7a479e7a6e75323ac9125656a9ca795e11ea42165ac4206af44d1b66e9563be9::svbtc::SVBTC',
              '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
            ],
          },
        ],
        'reserveIds': {
          '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
            'reserveId': '0x1a86cba9f4010bd1bc3a03f48d6d974411fb019b1dc0919fc265d55963bcfa0d',
            'balanceId': '0xfb094367ba02f778081335bc558f0ed735c63489a3eb9e8d13034558db5ee800',
          },
          'd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI': {
            'reserveId': '0x3e07003273528683cd7b98b306a0fbd153f716247fb95b66d8dfa81123f7e8bd',
            'balanceId': '0x1a529fb4d5e8efc65325f723ded066f80db2058d7d6de2d83dfe6ace4a76a424',
          },
          'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH': {
            'reserveId': '0x41557dc8ae7a960ad98dda30dd3893b623b583e62661c6b0329ba91b6428a8c9',
            'balanceId': '0xf9cc6f880eecc1191ec292251d7a9b366eaa8d0543bf2238a70bdc62cbabd5ce',
          },
          '549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT': {
            'reserveId': '0x4e41e1d47be4ad89c8758ba91337342f71279287c464266017a9c18ae4c73888',
            'balanceId': '0x1384b4efb401963c2f504af7293edb9bf945112ff44feae90e46d7bf1d7b296d',
          },
          '876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC': {
            'reserveId': '0x51786de1e046d891c3212be5a63d9ee9e017978a0a891d659775785b9f2590e4',
            'balanceId': '0xb032b33da753ed0a724877f292ba102c25320c6e65e7b2f149b95bbc54863fd5',
          },
          '960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY': {
            'reserveId': '0x519e4f4b0bddbced975515326e5e02dae0ba1935bf0d5ce0ce7b60ea773226af',
            'balanceId': '0x38ef831f75a3fab68771f6acd199dd8bf5c2314e5136b819a0e6d46bc6844beb',
          },
          'f325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI': {
            'reserveId': '0x58c0f037a8dcebc0c74da5229567c40d2b9deadc26d62acfb1ac31f3c042b361',
            'balanceId': '0xd3e27162ed4f58c79e32dabf98d5ec0eb2e55e31fe9d12b8d7b282144411d562',
          },
          'bde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': {
            'reserveId': '0x64234c4638b71b53609f8821177b3d526f6d2dcf71a86eb7085e80e71d196a4c',
            'balanceId': '0x5e4c98d7da8c391b3657dcf315bc065c3528f66c0176e1c7b7f6bad00c343518',
          },
          '83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': {
            'reserveId': '0x785caa33901e096ade6f8156219210da365a4000a5070139209c74c95fb2064e',
            'balanceId': '0xf992dc65feec32db0b8bb80b7895b5a485400467f618597bf450dc60556b5c77',
          },
          '44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI': {
            'reserveId': '0x8b3d8f515b9cab658fa879fc5dabae3c1d1059c28b40234d8394faec1ea09eb0',
            'balanceId': '0x9985e652e2f154d7511d9e76d61f311446418a1c0c1d64b55eb53871a5dfbef3',
          },
          'aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC': {
            'reserveId': '0xa3d309240bd6df7d6604bf26869a079861a6175a5f7e64218d6aea3bfc20c20b',
            'balanceId': '0xaa6dad84b5b64f624112662846a12bbc7441785fa3ec7a1b16d278b5200b5467',
          },
          'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
            'reserveId': '0xbdc6f58cad76fe6bdf5c10788ae6c1c20ebaa223aaabc7fb94185e83a88f5193',
            'balanceId': '0x296bad48a22775cf8e343acb2f33d2a6c0dfa1d160c40b6a2b0ba3cb92bf7e31',
          },
          'e14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB': {
            'reserveId': '0xce2f407d47141d28f55bf0306ddbeb7aeb83b268694a3653d36659061f634e93',
            'balanceId': '0x6776ddbcd693810e31bba8e7e4d24f0ef0ecad04f80f7d2b1d4cb79ea82e1b72',
          },
          'f16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD': {
            'reserveId': '0xd0a064d4dddbda2ba594721330d30f2aec3fe3df4e9646a434741fe5ecb95763',
            'balanceId': '0x2b07053352a5406bb11ebf937f2a6ca0ae0686247b6078a72a03216d659eab6f',
          },
          '3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC': {
            'reserveId': '0xe87f1bb21d536d369e9bca8055618f45fe1089de89d88ceebaff4eff1d3d838a',
            'balanceId': '0xa3bb1374781b81e4eb8fb2db5dd3a9b0d79cc092242913a29a5cb54ca9ee07cf',
          },
          '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': {
            'reserveId': '0xfe32ca9d6650de914d6e0d97e7409a2f3bf7c314d7c532c090a8d54941662082',
            'balanceId': '0x17ae9bb0db0d8feaeceecc554523ba3ed8a31cb140cce727f0a0790e98348c5f',
          },
          '8f2b5eb696ed88b71fea398d330bccfa52f6e2a5a8e1ac6180fcb25c6de42ebc::coin::COIN': {
            'reserveId': '0xa4743a995f2f6c3361ecce1f7a70bfc7a09a053a45ffd223581ea488d43e340f',
            'balanceId': '0xac8276b62be0d2ed297e8d38fec6449ae5354f97e538897bef441fe072350c24'
          },
        },
      },
      {
        'name': 'AltCoinMarket',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket',
        'objectId': '0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
              'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
        ],
        'reserveIds': {
          '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
            'reserveId': '0x1311a52ed5719407a3d88cbfd78f472b7307026019a5a3f977b4030ff21126ae',
            'balanceId': '0x48a2edb523041757313833e07df3a2afee8fc05b337504245f909b59c6c10236',
          },
          '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL': {
            'reserveId': '0x5a4bf8398263fbffbd536c823af5fbb60a78dc7936c9f46b9439b2fecfd65209',
            'balanceId': '0xc7d67cae4fdfb95caef4b181e35a5f46ae4015ca53df8c5a523e766985fcb881',
          },
          'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
            'reserveId': '0x66552de8e8ed96ec629dde6a1d4d11ae48c9f1964d76abd78daaeb72ea0424fc',
            'balanceId': '0x3c5288edb6cbe6c265ac2b0260f56f5ae6acea7243df2c4d1417b37ba7989eb5',
          },
          'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': {
            'reserveId': '0xbc080b427ec5d4407c7f00695b50936a96a12df10f536da55d22e9ac22080317',
            'balanceId': '0xcf5609ec0b28270e8e7a0f0b1618f5b36c41715b6360c7ea09f8743155eb609a',
          },
        },
      },
      {
        'name': 'EmberMarket',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket',
        'objectId': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              '66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI',
              '34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN',
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
          {
            'emodeId': 1,
            'name': 'esuisui',
            'assets': [
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
              '66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI',
            ],
          },
          {
            'emodeId': 2,
            'name': 'ethirdusdc',
            'assets': [
              '89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD',
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
            ],
          },
          {
            'emodeId': 3,
            'name': 'eearnusdc',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN',
            ],
          },
        ],
        'reserveIds': {
          'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
            'reserveId': '0x398785ad0676a3ded84b81289af64ca6a7695ac51c9813ce6209792a9aef933b',
            'balanceId': '0x135bd9083e44beb2975cff98b9418929a1e3e4d066d1ae1837057c7133ab68f0',
          },
          '66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI': {
            'reserveId': '0x79e42a9d16ec58574c5e3e00255cc7dda5ee394ddc81fcfb042b8090f8ff3ce6',
            'balanceId': '0x7b09e5541e756ad0ee29703f60b2b587b151e9133b1c8475a97e4af6f35105b5',
          },
          '89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD': {
            'reserveId': '0x899a072257adb2f0ccc1f63a35212a45d4ba8208705ec0927128b92defd33ef2',
            'balanceId': '0x8779eaf7dea0759beb028575440f5a0a7faf8b1f70b133a6868d073c539ea279',
          },
          '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
            'reserveId': '0xc926c90b417441019820fdc60cd7d40988f1cf2f1782bdbddfdb17d0ed90bf80',
            'balanceId': '0x74851d8f7571fbe820ba16f8096248cd243e88ad0cf810949b156d92f612018f',
          },
          '34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN': {
            'reserveId': '0xdedda74ac9dc3fed00ae719f990947b1a6f15b41b519b018ba8a169c1297c919',
            'balanceId': '0x26b554abfefb70c2882d766c3d34af465222ae95ae8c93eb4c871f4f67b51e8c',
          },
        },
      },
      {
        'name': 'MatrixGoldMarket',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket',
        'objectId': '0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM',
            ],
          },
        ],
        'reserveIds': {
          'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
            'reserveId': '0x0f2d2a19ef40e3a40172f49fb25cc65f92a0eee6dd641be8ea74ae2bf0eb2040',
            'balanceId': '0x74b47a2335cfa844759261cb4c94be9aabdae59354c1c8274b904073068af09e',
          },
          '9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM': {
            'reserveId': '0x51a93aa276c085330f2fc7a4917bbd022863f0784b39e08dc1b54fba143dbe4c',
            'balanceId': '0x8c31597dbff293d96f0ee4341344d7b95b752b1ac6584d401c01d54985d68cf1',
          },
        },
      },
      {
        'name': 'EthenaMarket',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket',
        'objectId': '0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE',
              '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
            ],
          },
        ],
        'reserveIds': {
          '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
            'reserveId': '0x9716bd380629ee1c735208d7c0e8c68031253562c5a8a841c7751b078c43bd4c',
            'balanceId': '0xc5e182e4e7cd3c579fcb4c7eb681d1c7dccf0c620332cd0a78424af4f1dd313d',
          },
          'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
            'reserveId': '0xc2c47b15769fcefcd12fec85be7ddc7395dc47bae94193382434ce146f6917f7',
            'balanceId': '0xb6bc436a71fec795c9da49f8bdaa953dccf253979d7ae1e46d5940ae69c485fb',
          },
          '41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE': {
            'reserveId': '0xd3d54e08df955f42e4c62993b9afae89162c58029e358e6bb217b9d4de9765ca',
            'balanceId': '0xc6d375a0c29ae56977d0e5ec5c497c672c558f7b96165a5923f58fcf0603a3f1',
          },
        },
      },
      {
        'name': 'Market01',
        'type': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01',
        'objectId': '0x2d682541f1e983e48d5c628f013d11d4c8f96f410338532791d3ece882766220',
        'emodeGroups': [
          {
            'emodeId': 0,
            'name': 'default',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
            ],
          },
          {
            'emodeId': 1,
            'name': 'susnmultiply',
            'assets': [
              'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              '0a672389b7b73df60d40666ac9545433d59d3128086b9e3a425a66bbffdf4dc5::susn::SUSN'
            ],
          },
        ],
        "reserveIds": {}
      },
    ],
    'leverageMarkets': [
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0x24e0c2e1ede9d285f0e2ea9124fb47b14a04f3b14eb29d7c51bdbbb6c321a980',
        'emodeId': 1,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xf34c027b6ee937f8820c3bca428fa66cf48e50cb4f0cc5e67bdfb623d5bf290a',
        'emodeId': 2,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0x8c667a45318340e0906ba94720d40eb14e088888597f6189c4306998a3e875cb',
        'emodeId': 3,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0x9f329ce155cba021c1d17503a8a346adc9804c7d1ac04ee8522de239fa3f7e45',
        'emodeId': 4,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xfb027814389ca236ad23ea8591ac11d07b8127d9799e7f7562c7eef1f1b915b9',
        'emodeId': 5,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xb2541f0ce7a2149d02a1c027290803bdccbe24749d67c260b106882081f571b3',
        'emodeId': 6,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xd21e25c24d04bff0767fdc0c707d599a9c725a0b79371173dc71c4452d377ea7',
        'emodeId': 7,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xef3145de72166a49d416d4c6c956d9d2f44110e0504fdb296bef6ce1cd9b80e3',
        'emodeId': 8,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xca6074b07cd8e47c7ee028e132d6f94e976e0995eb98ffe82cffd1ab6861051c',
        'emodeId': 9,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket',
        'lendingMarketId': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
        'lendingMarketName': 'EmberMarket',
        'objectId': '0x255e5c0a02bf6baa3d6955c270dae2fd6e7b06075e5c3fc18a1d95c69f24a63f',
        'emodeId': 1,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket',
        'lendingMarketId': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
        'lendingMarketName': 'EmberMarket',
        'objectId': '0xd34fe43a6bde2405ae76ee3987f834839d275c4d6f587dded60d309b35009f2e',
        'emodeId': 2,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket',
        'lendingMarketId': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
        'lendingMarketName': 'EmberMarket',
        'objectId': '0x0c691d9c8fb2f5a5783bf73d63786081f906f54cd61005cb0a019b9ec886e2c2',
        'emodeId': 3,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket',
        'lendingMarketId': '0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7',
        'lendingMarketName': 'AltCoinMarket',
        'objectId': '0xe2f7a831381f5e0f38ca73f8f79ad4ffe0dd6ef6b3536835a64963f54bed7088',
        'emodeId': 0,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0x681b5d5786efbd40092b05bbeb983f87f198b651ee6951cfd582630b77653f81',
        'emodeId': 0,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xb57360d0c9a21d2d22742af30871244fd46079635c56bf6df91a0727eef9c255',
        'emodeId': 10,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0x9ebdde67886c5bf617d312d844ee02af4adc94c741c5d2e0f6f950ccb19b12cd',
        'emodeId': 11,
      },
      {
        'lendingMarketType': '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
        'lendingMarketId': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
        'lendingMarketName': 'MainMarket',
        'objectId': '0xb4a9eecd24bff4ccfc6523e8615cc73c66f569dccd6dbef48edbdba6405b17d2',
        'emodeId': 13,
      },
    ],
    'xOracle': {
      "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI": {  "pyth": { "feedId": 11, "channelId": 4, "minPublishers": 3, "spotConfBps": 200, "emaConfBps": 100 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "SUIUSD", "emaFeedName": "SUIUSD" } },
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC": {  "pyth": { "feedId": 7, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT": {  "pyth": { "feedId": 8, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY": {  "pyth": { "feedId": 276, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 80 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB": {  "pyth": { "feedId": 2320, "channelId": 4, "minPublishers": 1, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD": {  "pyth": { "feedId": 88, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI": {  "pyth": { "feedId": 3049, "channelId": 4, "minPublishers": 2, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE": {  "pyth": { "feedId": 2998, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI": { "pyth": { "feedId": 3244, "channelId": 4, "minPublishers": 2, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 1, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI": { "pyth": { "feedId": 736, "channelId": 4, "minPublishers": 3, "spotConfBps": 200, "emaConfBps": 100 }, "config": { "baseTokenId": 1, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI": { "pyth": { "feedId": 3245, "channelId": 4, "minPublishers": 2, "spotConfBps": 200, "emaConfBps": 100 }, "config": { "baseTokenId": 1, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT": { "pyth": { "feedId": 2349, "channelId": 4, "minPublishers": 1, "spotConfBps": 200, "emaConfBps": 100 }, "config": { "baseTokenId": 1, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI": { "pyth": { "feedId": 11, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 100 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, "stork": { "feedName": "SUIUSD", "emaFeedName": "SUIUSD" } },
      "0x34469c8accdd673df02600265cbbad3688577f0e716866e257f88d448d463492::eearn::EEARN": { "pyth": { "feedId": 3161, "channelId": 4, "minPublishers": 1, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI": { "pyth": { "feedId": 3180, "channelId": 4, "minPublishers": 1, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, "stork": null },
      "0x89b0d4407f17cc1b1294464f28e176e29816a40612f7a553313ea0a797a5f803::ethird::ETHIRD": { "pyth": { "feedId": 3179, "channelId": 4, "minPublishers": 1, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC": { "pyth": { "feedId": 1, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "BTCUSD", "emaFeedName": "BTCUSD" } },
      "0x8f2b5eb696ed88b71fea398d330bccfa52f6e2a5a8e1ac6180fcb25c6de42ebc::coin::COIN": { "pyth": { "feedId": 1, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "BTCUSD", "emaFeedName": "BTCUSD" } },
      "0x7a479e7a6e75323ac9125656a9ca795e11ea42165ac4206af44d1b66e9563be9::svbtc::SVBTC": { "pyth": { "feedId": 1, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "BTCUSD", "emaFeedName": "BTCUSD" } },
      "0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH": { "pyth": { "feedId": 2, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "ETHUSD", "emaFeedName": "ETHUSD" } },
      "0x9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM": { "pyth": { "feedId": 3207, "channelId": 4, "minPublishers": 1, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 500, "upperBoundBps": 500, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "XAUMUSD", "emaFeedName": "XAUMUSD" } },
      "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC": { "pyth": { "feedId": 1598, "channelId": 4, "minPublishers": 3, "spotConfBps": 100, "emaConfBps": 50 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 1000, "upperBoundBps": 1000, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "BTCUSD", "emaFeedName": "BTCUSD" } },
      "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC": { "pyth": { "feedId": 468, "channelId": 4, "minPublishers": 3, "spotConfBps": 200, "emaConfBps": 100 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 2, "lowerBoundBps": 1000, "upperBoundBps": 1000, "maxUpdateTimeGapMs": 15000 }, "stork": { "feedName": "BTCUSD", "emaFeedName": "BTCUSD" } },
      "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP": { "pyth": { "feedId": 173, "channelId": 4, "minPublishers": 3, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 9999, "upperBoundBps": 9999, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL": { "pyth": { "feedId": 624, "channelId": 4, "minPublishers": 3, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 9999, "upperBoundBps": 9999, "maxUpdateTimeGapMs": 1209600000 }, stork: null },
      // haedal is just price fetch only
      "0x3a304c7feba2d819ea57c3542d68439ca2c386ba02159c740f7b406e592c62ea::haedal::HAEDAL": { "pyth": { "feedId": 648, "channelId": 4, "minPublishers": 3, "spotConfBps": 400, "emaConfBps": 200 }, "config": { "baseTokenId": 0, "primarySourceId": 1, "checkSourceId": 255, "lowerBoundBps": 100, "upperBoundBps": 100, "maxUpdateTimeGapMs": 1209600000 }, stork: null }
    },
    'protocolAppId': '0xd4395f77a48f6d64af2008280c8dc06ee0fe69953a141e683935f6086d849177',
  },
};

/**
 * Return the static reserve IDs (reserveId + balanceId per coin type) for the
 * given market from config, or null if none are baked in (caller should fall
 * back to on-chain discovery).
 *
 * Currently only (network='mainnet', Env.Production) serves static IDs.
 */
export function getStaticReserveIds(
  network: string,
  env: Env,
  marketObjectId: string,
  marketType: TypeName,
): Map<TypeName, ReserveIds> | null {
  if (env !== Env.Production || network !== 'mainnet') {
    return null;
  }
  const cfg = NETWORK_CONFIGS[network];
  if (!cfg) {
    return null;
  }
  const market = cfg.markets.find(
    (m) => m.objectId === marketObjectId && m.type === marketType,
  );
  if (!market || !market.reserveIds) {
    return null;
  }
  return new Map(Object.entries(market.reserveIds));
}

// Helper function to get network config
export function getNetworkConfig(network: string): NetworkConfig {
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Network configuration not found for: ${network}`);
  }
  return config;
}

// Helper function to get market by name
export function getMarket(network: string, marketName: string): MarketWithEmodes {
  const config = getNetworkConfig(network);
  const market = config.markets.find((m) => m.name === marketName);
  if (!market) {
    throw new Error(`Market '${marketName}' not found on ${network}`);
  }
  return market;
}

// Helper function to get market ID by name (for backward compatibility)
export function getMarketId(
  network: 'mainnet',
  marketName: string,
): string {
  const market = getMarket(network, marketName);
  return market.objectId;
}

// Helper function to get market type by name
export function getMarketType(
  network: 'mainnet',
  marketName: string,
): string {
  const market = getMarket(network, marketName);
  return market.type;
}