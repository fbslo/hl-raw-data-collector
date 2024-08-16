import WebSocket from "ws";
import axios from "axios";
import * as fs from 'node:fs/promises';
import cron from 'node-cron';

import { SpotMetaAndAssetCtxs, Token, UniverseToken, MarketData, CombinedTokenInfo } from './types'

const httpUrl: string = 'https://api.hyperliquid.xyz/info';
const wsUrl: string = 'wss://api.hyperliquid.xyz/ws';

const targetTokenSymbols: string[] = [
    "PURR",
    "HFUN",
    "RAGE",
    "POINTS",
    "JEFF"
]
const targetDepth: number[] = [1, 2, 5, 10, 20, 50]

let isAlreadyStored = false

cron.schedule('0 * * * *', () => {
    console.log(`Running at ${new Date()}`)
    main()
});

async function main(){
    isAlreadyStored = false;

    const spotMetaAndAssetCtxs = await getSpotMetaAndAssetCtxs()
    const universe = spotMetaAndAssetCtxs[0].universe
    const tokens = spotMetaAndAssetCtxs[0].tokens
    const marketData = spotMetaAndAssetCtxs[1]

    //find universe for target tokens
    const targetTokens: Token[] = tokens.filter((x: Token) => targetTokenSymbols.includes(x.name))
    const targetIndexes: number[] = targetTokens.map((x: Token) => x.index)
    const targetUniverses: UniverseToken[] = universe.filter((x: UniverseToken) => targetIndexes.includes(x.tokens[0]))
    const targetUniverseCoins: string[] = targetUniverses.map((x) => x.name)
    const targetMarketDetails: MarketData[] = marketData.filter((x: MarketData) => targetUniverseCoins.includes(x.coin))

    const combinedTokenInfos: CombinedTokenInfo[] = [];
    for (let i in targetIndexes){
        combinedTokenInfos[Number(i)] = {
            universe: targetUniverses[Number(i)],
            token: targetTokens[Number(i)],
            marketData: targetMarketDetails[Number(i)],
            requiredSigFig: [...new Set(targetDepth.map((e: number) => calculateNSigFigs(Number(targetMarketDetails[Number(i)].midPx), e)))]
        }
    }

    connectWebSocket(combinedTokenInfos)
}

async function getSpotMetaAndAssetCtxs(): Promise<SpotMetaAndAssetCtxs> {
    return (await axios.post(httpUrl, { type: "spotMetaAndAssetCtxs" })).data
}

function calculateNSigFigs(currentPrice: number, depthPercent: number): number {
    const depthRange = (depthPercent / 100) * currentPrice;
    const depthPrecision = Math.floor(Math.log10(depthRange));
    const pricePrecision = Math.floor(Math.log10(currentPrice));
    const nSigFigs = pricePrecision - depthPrecision + 1;
    return nSigFigs;
}

function countSignificantFigures(number: string) {
    let numStr = number.toString();
    if (numStr.includes('e')) {
        numStr = Number(number).toFixed(Math.abs(parseInt(numStr.split('e')[1])));
    }
    
    numStr = numStr.replace(/^0+/, '');
    if (numStr.includes('.')) {
        numStr = numStr.replace(/\.?0+$/, '');
    }
    
    let sigFigCount = 0;
    let inSignificant = true;
    for (let char of numStr) {
        if (char >= '1' && char <= '9') {
            inSignificant = false; // We are now in the significant part of the number
            sigFigCount++;
        } else if (char === '0' && !inSignificant) {
            sigFigCount++; // Zeros after the first non-zero digit are significant
        }
    }
    
    return sigFigCount;
}

let orderBookData: Record<string, Record<number, any>> = {} 

function connectWebSocket(combinedTokenInfos: CombinedTokenInfo[]) {
    const ws = new WebSocket(wsUrl);

    let finished: Record<number, boolean> = {}

    ws.on('open', () => {
        console.log('WebSocket connected');

        let k = 0;
        for (let i in combinedTokenInfos){
            for (let j in combinedTokenInfos[Number(i)].requiredSigFig){
                finished[k] = false;
                ws.send(JSON.stringify({
                    "method": "post",
                    "id": k,
                    "request": {
                        "type": "info",
                        "payload": {
                            "type": "l2Book",
                            "coin": combinedTokenInfos[Number(i)].universe.name,
                            "nSigFigs": combinedTokenInfos[Number(i)].requiredSigFig[Number(j)],
                        }
                    }
                }))
                k++;
            } 
        }
    });

  ws.on('message', async (data) => {
    try {
        const message = JSON.parse(data as any);
        
        if (message.channel == "post" && message.data.response.type == "error"){
            finished[message.data.id] = true;
        }

        if (message.channel == 'post' && message.data.response.type == "info") {
            const payload = message.data.response.payload
            const pair = payload.data.coin
            const levels = payload.data.levels;
            const nSigFig = countSignificantFigures(levels[1][0].px)

            let lastUpdate = orderBookData[pair] ? (orderBookData[pair][nSigFig] ? orderBookData[pair][nSigFig].lastUpdate : 0) : 0
            if (new Date().getTime() - 1000 * 60 * 10 > lastUpdate){
                console.log(`Updating ${pair}, nSigFig ${nSigFig}`)

                if (!orderBookData[pair]) orderBookData[pair] = {}
                if (!orderBookData[pair][nSigFig]) orderBookData[pair][nSigFig] = {}

                orderBookData[pair][nSigFig].lastUpdate = new Date().getTime()
                orderBookData[pair][nSigFig].levels = levels

                finished[message.data.id] = true;
            }

            if (Object.values(finished).every(value => value == true)){
                await storeData(orderBookData);
                ws.close()
            }
        }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

async function storeData(data: any){
    if (isAlreadyStored) return;
    isAlreadyStored = true
    console.log(`Storing data...`)
    let fileName = `./data/data_${new Date().getTime()}_${new Date().toISOString().replace(/:/g, "-").replace(/./g, "-")}.json`
    let jsonData = JSON.stringify(data)
    await fs.writeFile(fileName, jsonData);
}
