export interface Locale {
  [key: string]: string | undefined;
  // Vault / Auth
  vaultTitle: string; vaultSubtitle: string;
  firstTime: string; masterPwdPlaceholder: string;
  panicPwdNote: string; panicPwdPlaceholder: string;
  createVault: string; creating: string;
  unlockPlaceholder: string; unlockBtn: string;
  deriving: string; myGhosts: string;
  back: string; settings: string; noIdentities: string;
  exportQR: string; use: string;
  createGhost: string; ghostAlias: string;
  generateBtn: string; generating: string;
  importGhost: string; importAlias: string;
  importNsec: string; importBtn: string;
  encrypting: string; auditTitle: string;
  closeAndWipe: string; nsecWarning: string;

  // Nav
  navHome: string; navSearch: string; navGroups: string;
  navDirectory: string; navWeb: string; navMore: string;

  // More tab
  moreTitle: string; moreBack: string; moreGlobalSettings: string;
  moreDMs: string; moreSwitchId: string; moreLock: string;

  // Modals
  confirm: string; cancel: string; understood: string;
  masterPwd: string; verifying: string;
  lockTitle: string; lockDesc: string;
  dmTitle: string; dmDesc: string;
  unlockToExport: string; unlockToExportDesc: string;
  encryptAndImport: string; encryptAndImportDesc: string;

  // Feed
  forYou: string; following: string;
  composePlaceholder: string; publish: string; publishing: string;
  feedGlobal: string; feedFollowing: string;
  messages: string; all: string;
  loadingFeed: string; noMessages: string; noFollowing: string;
  connectingTor: string; connectedAs: string;
  torActive: string; torDirect: string; torDetecting: string;
  lockBtn: string; reply: string; private: string;
  replyingTo: string; kamikazeActive: string; realId: string;
  followToast: string; unfollowToast: string; blockedToast: string;
  blockConfirm: string; alreadyReacted: string;

  // Search
  searchPlaceholder: string; searchBtn: string;
  trending: string; loadingTrending: string;
  noResults: string; searchEmpty: string;

  // Settings
  settingsTitle: string; appearance: string; themeDesc: string;
  themeDark: string; themeLight: string;
  relaysTitle: string; relaysDesc: string;
  addRelay: string; removeRelay: string;
  powTitle: string; powDesc: string;
  securityTitle: string;
  masterPwdTitle: string; changeMasterPwd: string;
  currentPwd: string; newPwd: string; savePwd: string;
  panicTitle: string; panicDesc: string; savePanic: string;
  keyAuditTitle: string; keyAuditDesc: string;
  savedIdentities: string; importExternal: string;
  importAndSave: string;
  languageTitle: string; languageDesc: string;

  // Groups / Channels
  groupsTitle: string; createChannel: string;
  channelName: string; channelAbout: string;
  joinChannel: string; send: string; sending: string;
  channelPlaceholder: string; noChannels: string;

  // Directory
  directoryTitle: string; directorySearch: string;
  directoryEmpty: string; sendDM: string; follow: string;
  block: string;

  // DM
  dmChatPlaceholder: string; sendDMBtn: string;
  loadingHistory: string;
  dmPromptTitle?: string;
  dmPromptDesc?: string;
  dmPromptPlaceholder?: string;
  dmPromptStart?: string;
  dmTooltipTitle?: string;
  dmTooltipDesc?: string;
  copyPubkey?: string;

  // Sandbox
  secureBrowser: string; sandboxWarning: string;
  sandboxEmpty: string; sandboxEmptyDesc: string;

  // Common
  loading: string; error: string; close: string;
  loadingSettings: string; initSqlite: string;
  dbConnectError: string;
}

export type Lang = "es"|"en"|"zh"|"hi"|"ar"|"fr"|"ru"|"pt"|"bn"|"fa"|"de"|"ja"|"he";
