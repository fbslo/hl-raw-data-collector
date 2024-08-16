export type Token = {
    name: string;
    szDecimals: number;
    weiDecimals: number;
    index: number;
    tokenId: string;
    isCanonical: boolean;
    evmContract: string | null;
    fullName: string | null;
};
  
export type UniverseToken = {
    tokens: [number, number];
    name: string;
    index: number;
    isCanonical: boolean;
};
  
export type Universe = {
    universe: UniverseToken[];
    tokens: Token[];
};
  
export type MarketData = {
    prevDayPx: string;
    dayNtlVlm: string;
    markPx: string;
    midPx: string;
    circulatingSupply: string;
    coin: string;
};

export type CombinedTokenInfo = {
    universe: UniverseToken;
    token: Token;
    marketData: MarketData;
    requiredSigFig: Record<number, number>;
}
  
export type SpotMetaAndAssetCtxs = [Universe, MarketData[]];
  