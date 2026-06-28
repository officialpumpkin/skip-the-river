import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SUITS      = ['♠','♥','♦','♣'];
const SUIT_NAMES = { '♠':'Spades','♥':'Hearts','♦':'Diamonds','♣':'Clubs' };
const RANK_NAMES = { '2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine','10':'Ten','J':'Jack','Q':'Queen','K':'King','A':'Ace' };
const RANKS      = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUES= {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':12,'A':14};
const HAND_SIZE  = {3:9,4:7,5:6,6:6};
const POLL_MS    = 1500;
const BOT_NAMES  = ['Banjo','Pip','Marlow','Tessa','Quincy'];
const APP_VERSION = 'v2.7 · 2026-06-28';
const BOT_DELAYS = [450,950,1900,3200,5500];
const BOT_SPEED_LABELS = ['Fast','Normal','Slow','Very slow','Glacial'];

const cardName = c => c ? `${RANK_NAMES[c.rank]} of ${c.suit}` : '';

// Kid-friendly mode: replace the strong word in any user-facing string with "C".
// Applied at render time only — the stored game state / log always keep the
// original wording so the setting stays a per-device display preference.
const censor = (text, kid) => (kid && text) ? text.replace(/cunt/gi, 'C-word') : text;

// Render an activity log string, making suit symbols a bit larger and coloured
// so they're easy to read on the dark background.
const SUIT_SYMS = new Set(['♠','♥','♦','♣']);
const renderLog = text => {
  const parts = text.split(/(♠|♥|♦|♣)/);
  return parts.map((p,i) =>
    SUIT_SYMS.has(p)
      ? <span key={i} style={{fontSize:'1.3em',color:isRed(p)?'#e07878':'#c9c5b8',fontFamily:'"Georgia",serif'}}>{p}</span>
      : p
  );
};

// ─── DECK ─────────────────────────────────────────────────────────────────────
const makeDeck = () => {
  const d = [];
  for (const s of SUITS) for (const r of RANKS)
    d.push({ rank:r, suit:s, value:RANK_VALUES[r], id:`${r}${s}` });
  return d; // always 52 cards
};
const shuffle = arr => {
  const a = [...arr];
  for (let i=a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
};

// ─── LEGALITY ─────────────────────────────────────────────────────────────────
const regularPlay = (card, top, river) => {
  if (card.suit===top.suit && card.value>top.value) return {legal:true};
  if (card.value===top.value && card.suit!==top.suit) {
    const isKQ=(card.rank==='K'&&top.rank==='Q')||(card.rank==='Q'&&top.rank==='K');
    if (isKQ) {
      // King and Queen share value 12, so they can't match each other by the
      // same-value rule. EXCEPTION: a river card still beats a non-river card by
      // trump — this covers both river-K vs non-river-Q AND river-Q vs non-river-K.
      if (card.suit===river && top.suit!==river) return {legal:true};
      return {legal:false};
    }
    return {legal:true};
  }
  if (card.suit===river && top.suit!==river) return {legal:true};
  return {legal:false};
};
const isLegal = (card, top, river, locked, reset, forceRegular=false) => {
  // When the pile is reset OR the pile is empty (round start / opening play),
  // every card is legal — but a non-river Jack still changes the river suit.
  // The reset flag only removes the "must beat top card" obligation; it does not
  // strip a Jack of its river-changing power.
  if (reset || !top) {
    if (card.rank === 'J' && card.suit !== river && !locked) {
      return {legal:true, changesRiver:true, newRiverSuit:card.suit};
    }
    return {legal:true};
  }
  // forceRegular: player chose to play the 3 as a regular card instead of blocking.
  if (!forceRegular && card.rank==='3' && top.suit===river && top.rank!=='A' && top.rank!=='3')
    return {legal:true, blocks:true};
  if (card.rank==='J') {
    if (card.suit===river) return regularPlay(card,top,river);
    // River is locked — this Jack can't change it, but it's still a regular card (value 11)
    if (locked) return regularPlay(card,top,river);
    if (top.value>11) return {legal:false};
    return {legal:true, changesRiver:true, newRiverSuit:card.suit};
  }
  return regularPlay(card,top,river);
};
const getLegalMoves = (hand,top,river,locked,reset) =>
  hand.map(c=>({card:c, result:isLegal(c,top,river,locked,reset)})).filter(m=>m.result.legal);

// ─── BOT AI ───────────────────────────────────────────────────────────────────
// Four intelligence levels, selected per-bot in the lobby:
//   0 Random  — unpredictable skill: each turn it plays as a random one of the
//               three levels below, so it's never fully brainless but never reliable
//   1 Rookie  — knows to block with a 3; otherwise still pretty random
//   2 Decent  — uses the scoring system but draws from a wider random pool
//   3 Sharp   — full scoring system, tightly prefers the best-scored move

const BOT_INTEL_LABELS = ['🎲 Random','🐣 Rookie','🧩 Decent','🧠 Sharp'];

const botDecide = (hand, top, river, locked, reset, intelligence = 2) => {
  const legal = getLegalMoves(hand, top, river, locked, reset);
  if (!legal.length) return {action: 'draw'};

  // ── Level 0: random skill — behave as a random one of levels 1–3 this turn ──
  if (intelligence === 0) {
    const level = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
    return botDecide(hand, top, river, locked, reset, level);
  }

  // ── Level 1: basic awareness — block when obvious, otherwise random ───────
  if (intelligence === 1) {
    // Knows a 3 can reset the pile, but won't overthink anything else
    if (top && !reset) {
      const block = legal.find(m => m.result.blocks);
      if (block && Math.random() < 0.65) return {action:'play', cardId: block.card.id};
    }
    return {action:'play', cardId: legal[Math.floor(Math.random()*legal.length)].card.id};
  }

  // ── Levels 2 & 3: scoring system ─────────────────────────────────────────
  const hs        = hand.length;
  const suitCount = s => hand.filter(c => c.suit === s).length;

  const scored = legal.map(({card, result}) => {
    let score = 0;

    if (!top || reset) {
      // Opening / free play: preserve tactical cards
      if (card.rank === '3')                            score -= 25;
      if (card.rank === 'A')                            score -= 12;
      if (card.suit === river && card.rank !== 'J')     score -= 8;
      if (card.rank === 'J' && card.suit !== river)     score += 2 + suitCount(card.suit) * 2;
      score += Math.max(0, 5 - suitCount(card.suit));   // clear stragglers
      score -= Math.abs(card.value - 7) * 0.4;          // prefer mid-range
    } else {
      // Response play
      if (result.blocks) {
        score += 20 + top.value;
        if (hs <= 2) score -= 8;
      }
      if (card.rank === '3' && !result.blocks)          score -= 25;
      if (result.changesRiver) {
        score += 5 + suitCount(result.newRiverSuit) * 3;
        if (top.suit !== river) score += 5; // Cunt in the River trap bonus
      }
      if (card.suit === river && top.suit !== river) {
        score -= 5;
        if (card.rank === 'J') score -= 10;
        if (card.rank === 'A') score -= 6;
        score += suitCount(river) * 0.6;
      }
      score += Math.max(0, 4 - suitCount(card.suit));
      if (card.suit !== river) score -= card.value * 0.15;
    }
    if (hs <= 3) score += (4 - hs) * 5; // end-game urgency

    return {card, result, score};
  });

  scored.sort((a, b) => b.score - a.score);

  // Level 2: wider pool (up to 5), gentler weighting — more variable play
  // Level 3: tight pool (up to 3), sharp weighting — strongly prefers best move
  const poolSize  = intelligence === 2 ? Math.min(5, scored.length) : Math.min(3, scored.length);
  const decayRate = intelligence === 2 ? 0.55 : 0.35;
  const pool      = scored.slice(0, poolSize);
  const weights   = pool.map((_, i) => Math.pow(decayRate, i));
  const total     = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return {action:'play', cardId: pool[i].card.id};
  }
  return {action:'play', cardId: scored[0].card.id};
};

// ─── ROUND INIT ───────────────────────────────────────────────────────────────
const dealAndFlip = (players, dealerIdx, roundNumber, pendingSwapWinnerId) => {
  const deck = shuffle(makeDeck()); // fresh 52-card deck every round
  const n=players.length, hs=HAND_SIZE[n];
  const np=players.map(p=>({...p,hand:[],finishedRank:null}));
  let idx=0;
  for (let i=0;i<hs;i++) for (let p=0;p<n;p++) np[p].hand.push(deck[idx++]);
  // Auditable card count: hs*n dealt + 1 river flip + remaining = 52
  const first=(dealerIdx+1)%n;
  if (pendingSwapWinnerId && roundNumber>1) {
    const deckRemaining=deck.slice(idx);
    return {
      status:'swap-decision', players:np, deck:deckRemaining,
      playPile:[], riverSuit:null, riverLocked:false, riverCard:null,
      pileReset:false, lastPlayedPlayerIdx:null, lastPlayedByIdx:null, pendingResetTarget:null,
      dealerIdx, roundNumber, currentPlayerIdx:first,
      log:[{text:`Round ${roundNumber}: ${np.find(p=>p.id===pendingSwapWinnerId)?.name||'Winner'} may swap a card before the river is flipped. (${deckRemaining.length} cards in deck)`,ts:Date.now()}],
      finishedOrder:[], pendingSwapWinnerId, skipBell:0, specialMove:null,
    };
  }
  const top=deck[idx++];
  const deckRemaining=deck.slice(idx);
  // Sanity: hs*n + 1 (top/river) + deckRemaining.length should === 52
  // The river card only sets the suit — it does NOT go into the play pile.
  // The first player starts freely and their card opens the play pile.
  return {
    status:'playing', players:np, deck:deckRemaining,
    playPile:[], riverSuit:top.suit, riverLocked:top.rank==='J', riverCard:top,
    pileReset:false, lastPlayedPlayerIdx:null, lastPlayedByIdx:null,
    currentPlayerIdx:first, dealerIdx, roundNumber,
    log:[{text:`Round ${roundNumber} — ${cardName(top)} sets river: ${top.suit} ${SUIT_NAMES[top.suit]}${top.rank==='J'?' (LOCKED)':''}.  Deck: ${deckRemaining.length} cards.  ${np[first].name} goes first — play anything.`,ts:Date.now()}],
    finishedOrder:[], pendingSwapWinnerId:null, skipBell:0, specialMove:null,
  };
};

// ─── FINALIZE ROUND ───────────────────────────────────────────────────────────
const finalizeRoundIfDone = state => {
  if (state.players.filter(p=>p.hand.length>0).length>1) return state;
  const loserIdx=state.players.findIndex(p=>p.hand.length>0);
  const fo=[...state.finishedOrder];
  if (loserIdx>=0) fo.push(state.players[loserIdx].id);
  const players=state.players.map(p=>{
    const rank=fo.indexOf(p.id);
    let score=p.score||0;
    if (rank===0) score+=3;
    if (rank===1) score+=1;
    return {...p,score,finishedRank:rank};
  });
  const winnerId=fo[0];
  let streak=state.streak||{playerId:null,count:0};
  streak=streak.playerId===winnerId?{playerId:winnerId,count:streak.count+1}:{playerId:winnerId,count:1};
  const gameOver=(players.find(p=>p.id===winnerId)?.score||0)>=10;
  return {...state,players,status:gameOver?'game-over':'round-end',finishedOrder:fo,
    log:[...state.log,{text:`Round ${state.roundNumber} complete.`,ts:Date.now()}],
    pendingSwapWinnerId:winnerId,streak,gameWinnerId:gameOver?winnerId:null,
    dealerIdx:loserIdx>=0?loserIdx:state.dealerIdx};
};

// ─── APPLY MOVE ───────────────────────────────────────────────────────────────
const applyMove = (state,playerIdx,move) => {
  if (state.status!=='playing'||playerIdx!==state.currentPlayerIdx) return state;
  const player=state.players[playerIdx];
  let players=[...state.players],deck=[...state.deck],playPile=[...state.playPile];
  let {riverSuit,riverLocked,riverCard}=state;
  // pileReset starts false; only a 3-block or the full-table-pass check below sets it true.
  // Draws do NOT carry pileReset forward — drawing consumes/waives a free play.
  let pileReset=false;
  const log=[...state.log];
  let specialMove=null,skipBell=state.skipBell;
  let lastPlayedPlayerIdx=state.lastPlayedPlayerIdx??null;
  let lastPlayedByIdx=state.lastPlayedByIdx??null; // for animation direction
  let pendingResetTarget=state.pendingResetTarget??null;

  if (move.action==='draw') {
    if (!deck.length) log.push({text:`${player.name} passed (deck empty).`,ts:Date.now()});
    else { const d=deck.shift(); players[playerIdx]={...player,hand:[...player.hand,d]}; log.push({text:`${player.name} drew a card.`,ts:Date.now()}); }
    // Drawing does NOT carry pileReset forward — free play is consumed.
    // lastPlayedPlayerIdx and pendingResetTarget are unchanged (the card setter is still the same).
    pileReset=false;
  } else if (move.action==='play') {
    const top=playPile[playPile.length-1]||null;
    const ci=player.hand.findIndex(c=>c.id===move.cardId); if(ci<0)return state;
    const card=player.hand[ci];
    const result=isLegal(card,top,riverSuit,riverLocked,state.pileReset,move.forceRegular||false);
    if (!result.legal) return state;
    const newHand=player.hand.filter((_,i)=>i!==ci);
    players[playerIdx]={...player,hand:newHand};

    if (result.changesRiver) {
      // ── Jack changes river → goes to the RIVER pile, NOT the TO BEAT pile ──
      // The TO BEAT card is UNCHANGED. The original card setter stays the setter.
      // We do NOT update lastPlayedPlayerIdx / lastPlayedByIdx / pendingResetTarget —
      // nothing new has been placed on the TO BEAT pile.
      const oldRiver=riverSuit;
      riverSuit=result.newRiverSuit;
      riverCard=card;
      if (top&&top.suit!==oldRiver&&card.suit===top.suit) {
        specialMove={kind:'cunt',by:player.name};
        log.push({text:`${player.name} dropped a Cunt in the River! (${riverSuit} ${SUIT_NAMES[riverSuit]} now river)`,ts:Date.now()});
      } else if (top&&top.suit===oldRiver) {
        specialMove={kind:'skip',by:player.name};
        skipBell+=1;
        log.push({text:`${player.name} Skipped the River! (${riverSuit} ${SUIT_NAMES[riverSuit]} now river) 🔔`,ts:Date.now()});
      } else {
        log.push({text:`${player.name} played ${cardName(card)}. River → ${riverSuit} ${SUIT_NAMES[riverSuit]}.`,ts:Date.now()});
      }
    } else {
      // ── Regular play (incl. 3-block and river-suit Jack as regular) → TO BEAT pile ──
      playPile.push(card);
      lastPlayedPlayerIdx=playerIdx;
      lastPlayedByIdx=playerIdx;
      pendingResetTarget=null;
      if (result.blocks) {
        pileReset=true;
        log.push({text:`${player.name} blocked with ${card.rank}${card.suit}. Pile reset — play anything.`,ts:Date.now()});
      } else {
        log.push({text:`${player.name} played ${cardName(card)}.`,ts:Date.now()});
      }
    }

    if (!newHand.length) {
      const fo=[...state.finishedOrder,player.id];
      const places=['1st 🥇','2nd 🥈','3rd 🥉','4th','5th','6th'];
      log.push({text:`${player.name} is OUT! (${places[fo.length-1]||'done'})`,ts:Date.now()});
      const ns0={...state,players,deck,playPile,riverSuit,riverLocked,riverCard,pileReset,log,finishedOrder:fo,skipBell,specialMove,lastPlayedPlayerIdx,lastPlayedByIdx,pendingResetTarget};
      const nextIdx=nextPlayerIdx(ns0,playerIdx);
      const ns1=applyFullTablePassCheck({...ns0,currentPlayerIdx:nextIdx},nextIdx);
      return finalizeRoundIfDone(ns1);
    }
  }
  const ns0={...state,players,deck,playPile,riverSuit,riverLocked,riverCard,pileReset,log,skipBell,specialMove,lastPlayedPlayerIdx,lastPlayedByIdx,pendingResetTarget};
  const nextIdx=nextPlayerIdx(ns0,playerIdx);
  const ns=applyFullTablePassCheck({...ns0,currentPlayerIdx:nextIdx},nextIdx);
  return ns;
};

// Called when we've just decided who goes next.
// Two cases:
//   1. Setter is still active  — fire when the turn returns to them (full circle).
//   2. Setter has gone out     — fire when the turn returns to the first active player
//                                AFTER the setter, but only on the SECOND visit (after
//                                everyone else has had at least one chance to pass).
//                                `pendingResetTarget` handles the two-visit bookkeeping.
const applyFullTablePassCheck=(state,nextIdx)=>{
  if (state.pileReset) return state;
  if (state.lastPlayedPlayerIdx===null) return state;

  const setter=state.players[state.lastPlayedPlayerIdx];

  // ── Case 1: setter still has cards ───────────────────────────────────────
  if (setter && setter.hand.length>0) {
    if (nextIdx!==state.lastPlayedPlayerIdx) return state;
    const newLog=[...state.log,{text:`Everyone else passed — ${setter.name} can now play freely.`,ts:Date.now()}];
    return {...state, pileReset:true, lastPlayedPlayerIdx:null, pendingResetTarget:null, log:newLog};
  }

  // ── Case 2: setter went out — use pendingResetTarget ─────────────────────
  // The first time we arrive here after the setter finishes, just record who the
  // beneficiary will be (the first active player after the setter). On every
  // subsequent call, check if the turn has cycled back to that player.
  if (setter && setter.hand.length===0) {
    // Compute who gets the free play: first active player after the setter.
    const target = state.pendingResetTarget !== null
      ? state.pendingResetTarget
      : nextPlayerIdx(state, state.lastPlayedPlayerIdx);

    if (state.pendingResetTarget===null) {
      // First visit after setter went out — register the target, don't trigger yet.
      return {...state, pendingResetTarget: target};
    }

    if (nextIdx===target) {
      // Turn has cycled back to the target — everyone has passed. Grant free play.
      const beneficiary=state.players[target];
      if (beneficiary && beneficiary.hand.length>0) {
        const newLog=[...state.log,{text:`Everyone passed — ${beneficiary.name} can now play freely.`,ts:Date.now()}];
        return {...state, pileReset:true, lastPlayedPlayerIdx:null, pendingResetTarget:null, log:newLog};
      }
      // Beneficiary also finished — shift target to the next active player.
      const newTarget=nextPlayerIdx(state, target);
      if (newTarget===target) return state; // only one player left; round ends elsewhere
      return {...state, pendingResetTarget: newTarget};
    }
  }

  return state;
};
const nextPlayerIdx=(state,from)=>{
  const n=state.players.length; let i=(from+1)%n;
  for(let k=0;k<n;k++){if(state.players[i].hand.length>0)return i;i=(i+1)%n;}
  return from;
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
import { storageGet, storageSet } from './firebase.js';
const roomKey=code=>`skip_river_room_${code}`;
const genRoomCode=()=>Math.random().toString(36).slice(2,6).toUpperCase();
const genPlayerId=()=>'p_'+Math.random().toString(36).slice(2,10);

// ─── BELL ─────────────────────────────────────────────────────────────────────
const playBell=()=>{try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator();const g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(1320,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(660,ctx.currentTime+0.8);g.gain.setValueAtTime(0.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.35,ctx.currentTime+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+1.2);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+1.3);}catch{}};

// ─── CARD COMPONENT ───────────────────────────────────────────────────────────
// All sizes verified: cornerBlock (pad+rankF+2+suitF with lineHeight:1) < centerTop (h/2−bigF/2)
// sm:26<29 ✓  md:35<41 ✓  lg:44<52 ✓  xl:55<63 ✓
const CARD_SIZES={
  sm:{w:50, h:72,  pad:4,rankF:12,suitF:10,bigF:20,r:6},
  md:{w:72, h:104, pad:5,rankF:16,suitF:12,bigF:26,r:8},
  lg:{w:94, h:136, pad:6,rankF:20,suitF:16,bigF:32,r:9},
  xl:{w:116,h:168, pad:8,rankF:25,suitF:20,bigF:40,r:11},
};
const isRed=s=>s==='♥'||s==='♦';

const Card=({card,size='md',onClick,dimmed,highlighted,faceDown,style,animClass})=>{
  const s=CARD_SIZES[size]||CARD_SIZES.md;
  if(faceDown)return(
    <div onClick={onClick} className={animClass} style={{width:s.w,height:s.h,background:'linear-gradient(145deg,#7a1e1e 0%,#3d0a0a 55%,#5a1515 100%)',border:'2px solid #c9a961',borderRadius:s.r,flexShrink:0,boxShadow:'0 4px 14px rgba(0,0,0,0.6),inset 0 0 0 2px rgba(201,169,97,0.2)',position:'relative',cursor:onClick?'pointer':'default',...style}}>
      <div style={{position:'absolute',inset:5,border:'1px solid rgba(201,169,97,0.3)',borderRadius:s.r-2,backgroundImage:'repeating-linear-gradient(45deg,rgba(201,169,97,0.07) 0,rgba(201,169,97,0.07) 1px,transparent 1px,transparent 9px),repeating-linear-gradient(-45deg,rgba(201,169,97,0.07) 0,rgba(201,169,97,0.07) 1px,transparent 1px,transparent 9px)'}}/>
    </div>
  );
  if(!card)return null;
  const color=isRed(card.suit)?'#8b0000':'#0d0d0d';
  const CB=()=>(
    <div style={{fontFamily:'"Georgia",serif',color,userSelect:'none',textAlign:'center'}}>
      <div style={{fontSize:s.rankF,fontWeight:700,lineHeight:1,letterSpacing:'-0.02em'}}>{card.rank}</div>
      <div style={{fontSize:s.suitF,lineHeight:1,marginTop:2}}>{card.suit}</div>
    </div>
  );
  return(
    <div onClick={onClick} className={animClass} style={{width:s.w,height:s.h,background:'linear-gradient(175deg,#fffef8 0%,#faf4e6 55%,#f3e9d2 100%)',border:`${highlighted?2:1.5}px solid ${highlighted?'#c9a961':'rgba(80,60,30,0.4)'}`,borderRadius:s.r,position:'relative',boxShadow:highlighted?'0 0 0 2.5px rgba(201,169,97,0.65),0 8px 22px rgba(0,0,0,0.5)':dimmed?'0 1px 3px rgba(0,0,0,0.2)':'0 4px 12px rgba(0,0,0,0.42)',opacity:dimmed?0.35:1,cursor:onClick?'pointer':'default',transition:'transform 0.2s ease,box-shadow 0.2s ease,opacity 0.2s ease',userSelect:'none',transform:highlighted?'translateY(-10px)':'none',flexShrink:0,overflow:'hidden',...style}}>
      <div style={{position:'absolute',top:s.pad,left:s.pad}}><CB/></div>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:s.bigF,lineHeight:1,color,fontFamily:'"Georgia",serif',pointerEvents:'none',userSelect:'none'}}>{card.suit}</div>
      <div style={{position:'absolute',bottom:s.pad,right:s.pad,transform:'rotate(180deg)'}}><CB/></div>
    </div>
  );
};

// ─── OTHER PLAYER VISUAL ──────────────────────────────────────────────────────
// Shows a fanned stack of face-down cards instead of text.
// Hover/touch shows exact count in a tooltip.
function OtherPlayer({p,isTurn}) {
  const [tip,setTip]=useState(false);
  const CW=26, CH=38, GAP=7;
  const show=Math.min(p.hand.length,9);
  const extra=p.hand.length-show;
  const stackW=show>0?CW+(show-1)*GAP:CW;
  const isOut=p.finishedRank!==null&&p.finishedRank!==undefined&&p.finishedRank>=0;
  return(
    <div onMouseEnter={()=>setTip(true)} onMouseLeave={()=>setTip(false)} onTouchStart={()=>setTip(v=>!v)}
      style={{flex:'0 0 auto',padding:'8px 10px',borderRadius:8,position:'relative',background:isTurn?'rgba(201,169,97,0.25)':'rgba(0,0,0,0.3)',border:isTurn?'1.5px solid #c9a961':'1px solid rgba(232,226,205,0.1)',minWidth:70}}>
      <div style={{fontSize:11,fontWeight:600,color:'#f5e9c8',marginBottom:6,whiteSpace:'nowrap'}}>{p.name}{p.isBot&&` 🤖 ${BOT_INTEL_LABELS[p.intelligence??2]?.split(' ')[0]||''}`}</div>
      {isOut?(
        <div style={{height:CH+4,display:'flex',alignItems:'center',fontSize:16}}>
          {p.finishedRank===0?'🥇':p.finishedRank===1?'🥈':p.finishedRank===2?'🥉':'✓'}
        </div>
      ):(
        <div style={{position:'relative',height:CH+4,width:stackW+8}}>
          {Array.from({length:show}).map((_,i)=>(
            <div key={i} style={{position:'absolute',left:i*GAP,top:0,width:CW,height:CH,
              background:'linear-gradient(145deg,#7a1e1e 0%,#3d0a0a 55%,#5a1515 100%)',
              border:'1.5px solid rgba(201,169,97,0.55)',borderRadius:4,
              boxShadow:'0 2px 6px rgba(0,0,0,0.4)',zIndex:i,
              backgroundImage:'repeating-linear-gradient(45deg,rgba(201,169,97,0.06) 0,rgba(201,169,97,0.06) 1px,transparent 1px,transparent 7px)'}}/>
          ))}
          {extra>0&&<div style={{position:'absolute',right:-2,top:-7,background:'#c9a961',color:'#0d0d0d',fontSize:9,fontWeight:700,borderRadius:8,padding:'0 4px',lineHeight:'15px',zIndex:20}}>+{extra}</div>}
        </div>
      )}
      {/* Always-visible card count */}
      <div style={{fontSize:10,color:'#9aa39a',marginTop:2}}>
        {isOut?'':p.hand.length+' card'+(p.hand.length!==1?'s':'')}
      </div>
      <div style={{fontSize:10,color:'#9aa39a'}}>{p.score||0} pts</div>
      {tip&&!isOut&&p.hand.length>0&&(
        <div style={{position:'absolute',top:'100%',left:'50%',transform:'translateX(-50%)',marginTop:6,background:'rgba(5,15,10,0.97)',border:'1px solid rgba(201,169,97,0.35)',color:'#e8e2cd',fontSize:12,padding:'4px 10px',borderRadius:5,whiteSpace:'nowrap',zIndex:50,pointerEvents:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
          {p.hand.length} card{p.hand.length!==1?'s':''}
        </div>
      )}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,     setScreen]    = useState('home');
  const [playerId,   setPlayerId]  = useState(null);
  const [playerName, setPlayerName]= useState('');
  const [nameInput,  setNameInput] = useState('');
  const [joinCode,   setJoinCode]  = useState('');
  const [roomCode,   setRoomCode]  = useState(null);
  const [mode,       setMode]      = useState(null);
  const [gameState,  setGameState] = useState(null);
  const [error,      setError]     = useState('');
  const [showRules,  setShowRules] = useState(false);
  const [specialAnnounce,setSpecialAnnounce]=useState(null);
  const [riverFlipPhase,setRiverFlipPhase]=useState('done');
  const [topCardAnimKey,setTopCardAnimKey]=useState(0);
  const [botSpeed,   setBotSpeed]  = useState(1);
  const [cardAnimDir,setCardAnimDir]= useState('below'); // 'above'|'below' — card fly direction
  const [blockChoice,setBlockChoice]= useState(null); // {cardId} — awaiting block-or-regular choice
  const [kidMode,    setKidMode]   = useState(false); // hides adult language (per-device)
  const [showWarning,setShowWarning]= useState(false); // first-load adult-language notice

  const prevRoundKeyRef=useRef(null);
  const prevTopIdRef=useRef(null);
  const lastBellRef=useRef(0);
  const lastSpecialRef=useRef(null);
  const writeLockRef=useRef(false);
  const logRef=useRef(null);

  // Derived — declared before all useEffects to avoid temporal dead zone errors
  const myIdx   = gameState?.players.findIndex(p=>p.id===playerId)??-1;
  const me      = myIdx>=0 ? gameState?.players[myIdx] : null;
  const isMyTurn= gameState?.status==='playing' && gameState?.currentPlayerIdx===myIdx;
  const top     = gameState?.playPile?.[gameState.playPile.length-1]||null;
  // River-suit (trump) cards and Jack river-changers are optional — only non-trump plays force you to play.
  const hasLegalPlay = !!(isMyTurn && me && getLegalMoves(me.hand, top, gameState.riverSuit, gameState.riverLocked, gameState.pileReset).some(m=>!m.result.changesRiver && m.card.suit!==gameState.riverSuit));

  useEffect(()=>{(async()=>{
    let pid=await storageGet('skip_river_pid',false);
    if(!pid){pid=genPlayerId();await storageSet('skip_river_pid',pid,false);}
    setPlayerId(pid);
    const n=await storageGet('skip_river_name',false);
    if(n){setPlayerName(n);setNameInput(n);}
    // Adult-language notice + kid-friendly preference (per-device)
    if(await storageGet('skip_river_kidmode',false)==='1')setKidMode(true);
    if(await storageGet('skip_river_warned',false)!=='1')setShowWarning(true);
  })();},[]);

  const toggleKidMode=async v=>{setKidMode(v);await storageSet('skip_river_kidmode',v?'1':'0',false);};
  const dismissWarning=async()=>{setShowWarning(false);await storageSet('skip_river_warned','1',false);};

  useEffect(()=>{
    if(mode!=='online'||!roomCode)return;
    let cancelled=false;
    const poll=async()=>{
      if(writeLockRef.current)return;
      const raw=await storageGet(roomKey(roomCode),true);
      if(!raw||cancelled)return;
      try{const next=JSON.parse(raw);setGameState(prev=>(!prev||next.version!==prev.version)?next:prev);}catch{}
    };
    poll();
    const id=setInterval(poll,POLL_MS);
    return()=>{cancelled=true;clearInterval(id);};
  },[mode,roomCode]);

  const writeState=useCallback(async mutator=>{
    if(mode==='online'){
      writeLockRef.current=true;
      const raw=await storageGet(roomKey(roomCode),true);
      const cur=raw?JSON.parse(raw):null;
      const next=mutator(cur||gameState);
      if(!next){writeLockRef.current=false;return;}
      next.version=(cur?.version||0)+1;
      await storageSet(roomKey(roomCode),JSON.stringify(next),true);
      setGameState(next);
      writeLockRef.current=false;
    }else{
      // Offline (vs bots): bump version on every real change so per-move effects
      // (e.g. the special-move overlay, which dedups on version) fire each time.
      setGameState(prev=>{
        const next=mutator(prev);
        if(!next||next===prev)return prev;
        return {...next,version:(prev?.version||0)+1};
      });
    }
  },[mode,roomCode,gameState]);

  useEffect(()=>{
    if(!gameState?.specialMove)return;
    const key=`${gameState.specialMove.kind}-${gameState.version||0}-${gameState.specialMove.by}`;
    if(lastSpecialRef.current===key)return;
    lastSpecialRef.current=key;
    setSpecialAnnounce(gameState.specialMove);
    setTimeout(()=>setSpecialAnnounce(null),2800);
  },[gameState?.specialMove,gameState?.version]);

  useEffect(()=>{
    if(!gameState?.skipBell)return;
    if(gameState.skipBell>lastBellRef.current){lastBellRef.current=gameState.skipBell;playBell();}
  },[gameState?.skipBell]);

  // River flip ceremony — fires at the start of each new round (empty pile = no cards played yet)
  useEffect(()=>{
    if(!gameState||gameState.status!=='playing')return;
    const rk=`r${gameState.roundNumber}`; // round number only — mid-round jack changes must NOT re-fire
    if(rk===prevRoundKeyRef.current)return;
    if((gameState.playPile?.length||0)!==0)return; // only at round start
    prevRoundKeyRef.current=rk;
    setRiverFlipPhase('facedown');
    const t1=setTimeout(()=>setRiverFlipPhase('flipping'),220);
    const t2=setTimeout(()=>setRiverFlipPhase('revealed'),1350);
    const t3=setTimeout(()=>setRiverFlipPhase('flying'),2600);  // card flies to river corner
    const t4=setTimeout(()=>setRiverFlipPhase('done'),3350);
    return()=>{clearTimeout(t1);clearTimeout(t2);clearTimeout(t3);clearTimeout(t4);};
  },[gameState?.roundNumber,gameState?.status,gameState?.playPile?.length]);

  // Card play animation — direction depends on who played
  useEffect(()=>{
    const newId=gameState?.playPile?.[gameState.playPile.length-1]?.id;
    if(!newId||newId===prevTopIdRef.current)return;
    prevTopIdRef.current=newId;
    if(riverFlipPhase==='done'){
      // Animate from below if human played, from above if opponent/bot played
      const playedByMe = gameState.lastPlayedByIdx===myIdx;
      setCardAnimDir(playedByMe?'below':'above');
      setTopCardAnimKey(k=>k+1);
    }
  },[gameState?.playPile,gameState?.lastPlayedByIdx,riverFlipPhase,myIdx]);

  // Activity log — auto-scroll to bottom (newest entry)
  useEffect(()=>{
    if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight;
  },[gameState?.log?.length]);

  // Redirect lobby→game on start
  useEffect(()=>{
    if(gameState?.status==='playing'&&screen==='lobby')setScreen('game');
  },[gameState?.status,screen]);

  // Bot turns
  // IMPORTANT: botDecide is called INSIDE the writeState mutator so it reads
  // cur.pileReset (fresh) rather than gameState.pileReset (closure snapshot).
  // This ensures full-table-pass resets are seen by the bot correctly.
  useEffect(()=>{
    if(!gameState||gameState.status!=='playing')return;
    if(riverFlipPhase!=='done')return;
    const cp=gameState.players[gameState.currentPlayerIdx];
    if(!cp||!cp.isBot)return;
    if(mode==='online'&&gameState.hostId!==playerId)return;
    const capturedIdx=gameState.currentPlayerIdx; // capture index to match inside mutator
    const delay=BOT_DELAYS[botSpeed]+Math.random()*400;
    const t=setTimeout(()=>{
      writeState(cur=>{
        // Guard: make sure it's still this bot's turn in the latest state
        if(!cur||cur.status!=='playing') return cur;
        if(cur.currentPlayerIdx!==capturedIdx) return cur;
        const curBot=cur.players[capturedIdx];
        if(!curBot||!curBot.isBot) return cur;
        const top=cur.playPile[cur.playPile.length-1];
        // Use cur.pileReset — guaranteed fresh, not a stale closure value
        const mv=botDecide(curBot.hand,top,cur.riverSuit,cur.riverLocked,cur.pileReset,curBot.intelligence??2);
        return applyMove(cur,capturedIdx,mv);
      });
    },delay);
    return()=>clearTimeout(t);
  },[gameState?.currentPlayerIdx,gameState?.status,gameState?.version,riverFlipPhase,botSpeed,playerId,mode,writeState]);

  // Bot swap decision
  useEffect(()=>{
    if(!gameState||gameState.status!=='swap-decision')return;
    const winner=gameState.players.find(p=>p.id===gameState.pendingSwapWinnerId);
    if(!winner||!winner.isBot)return;
    if(mode==='online'&&gameState.hostId!==playerId)return;
    const delay=BOT_DELAYS[botSpeed]+Math.random()*400;
    const t=setTimeout(()=>{
      if(Math.random()<0.3&&winner.hand.length>0){
        const tgt=[...winner.hand].sort((a,b)=>a.value-b.value)[0];
        writeState(cur=>{
          if(cur.status!=='swap-decision')return cur;
          const wi=cur.players.findIndex(p=>p.id===cur.pendingSwapWinnerId);if(wi<0)return cur;
          const ps=[...cur.players];const pl={...ps[wi],hand:[...ps[wi].hand]};
          const ci=pl.hand.findIndex(c=>c.id===tgt.id);if(ci<0)return cur;
          const old=pl.hand.splice(ci,1)[0];const dk=[...cur.deck];const nc=dk.shift();pl.hand.push(nc);dk.push(old);ps[wi]=pl;
          const nt=dk.shift();
          const first=(cur.dealerIdx+1)%cur.players.length;
          return{...cur,players:ps,deck:dk,playPile:[],riverSuit:nt.suit,riverLocked:nt.rank==='J',riverCard:nt,pileReset:false,lastPlayedPlayerIdx:null,lastPlayedByIdx:null,pendingResetTarget:null,currentPlayerIdx:first,status:'playing',log:[...cur.log,{text:`${pl.name} swapped. ${cardName(nt)} sets river: ${nt.suit} ${SUIT_NAMES[nt.suit]}${nt.rank==='J'?' (LOCKED)':''}.`,ts:Date.now()}],pendingSwapWinnerId:null};
        });
      }else{
        writeState(cur=>{
          if(cur.status!=='swap-decision')return cur;
          const dk=[...cur.deck];const nt=dk.shift();
          const first=(cur.dealerIdx+1)%cur.players.length;
          return{...cur,deck:dk,playPile:[],riverSuit:nt.suit,riverLocked:nt.rank==='J',riverCard:nt,pileReset:false,lastPlayedPlayerIdx:null,lastPlayedByIdx:null,pendingResetTarget:null,currentPlayerIdx:first,status:'playing',log:[...cur.log,{text:`${cardName(nt)} sets river: ${nt.suit} ${SUIT_NAMES[nt.suit]}${nt.rank==='J'?' (LOCKED)':''}.`,ts:Date.now()}],pendingSwapWinnerId:null};
        });
      }
    },delay);
    return()=>clearTimeout(t);
  },[gameState?.status,gameState?.pendingSwapWinnerId,gameState?.version,botSpeed,playerId,mode,writeState]);

  // Auto-advance round-end in bots mode
  useEffect(()=>{
    if(!gameState||gameState.status!=='round-end'||mode!=='bots')return;
    const t=setTimeout(()=>{
      writeState(cur=>{
        if(cur.status!=='round-end')return cur;
        return{...cur,...dealAndFlip(cur.players,cur.dealerIdx,cur.roundNumber+1,cur.pendingSwapWinnerId)};
      });
    },3500);
    return()=>clearTimeout(t);
  },[gameState?.status,gameState?.version,mode,writeState]);

  useEffect(()=>{
    if(gameState?.streak?.count===4){
      const w=gameState.players.find(p=>p.id===gameState.streak.playerId);
      if(w)setTimeout(()=>alert(`🍽️ FREE DINNER! ${w.name} has won 4 rounds in a row!`),300);
    }
  },[gameState?.streak?.count]);

  // Clear any pending block choice if the turn moves on (opponent played, round changed, etc.)
  useEffect(()=>{setBlockChoice(null);},[gameState?.currentPlayerIdx,gameState?.status]);

  const saveName=async n=>{setPlayerName(n);await storageSet('skip_river_name',n,false);};

  const createOnlineRoom=async()=>{
    if(!playerName){setError('Enter your name first');return;}
    const code=genRoomCode();
    const state={version:1,status:'lobby',hostId:playerId,roomCode:code,players:[{id:playerId,name:playerName,isBot:false,hand:[],score:0}],log:[{text:`${playerName} created the room.`,ts:Date.now()}],roundNumber:1,dealerIdx:0};
    await storageSet(roomKey(code),JSON.stringify(state),true);
    setRoomCode(code);setMode('online');setGameState(state);setScreen('lobby');setError('');
  };

  const joinOnlineRoom=async()=>{
    if(!playerName){setError('Enter your name first');return;}
    if(!joinCode){setError('Enter a room code');return;}
    const code=joinCode.toUpperCase();
    const raw=await storageGet(roomKey(code),true);
    if(!raw){setError('Room not found');return;}
    const state=JSON.parse(raw);
    if(state.players.some(p=>p.id===playerId)){
      setRoomCode(code);setMode('online');setGameState(state);
      setScreen(state.status==='lobby'?'lobby':'game');setError('');return;
    }
    if(state.status!=='lobby'){setError('Game already started');return;}
    if(state.players.length>=6){setError('Room full');return;}
    state.players.push({id:playerId,name:playerName,isBot:false,hand:[],score:0});
    state.log.push({text:`${playerName} joined.`,ts:Date.now()});
    state.version+=1;
    await storageSet(roomKey(code),JSON.stringify(state),true);
    setRoomCode(code);setMode('online');setGameState(state);setScreen('lobby');setError('');
  };

  const startBotsGame=n=>{
    if(!playerName){setError('Enter your name first');return;}
    const bots=shuffle(BOT_NAMES);
    const players=[{id:playerId,name:playerName,isBot:false,hand:[],score:0}];
    for(let i=0;i<n;i++)players.push({id:'bot_'+i,name:bots[i],isBot:true,hand:[],score:0,intelligence:2});
    setRoomCode(null);setMode('bots');
    setGameState({version:1,status:'lobby',hostId:playerId,roomCode:'LOCAL',players,log:[],roundNumber:1,dealerIdx:0});
    setScreen('lobby');setError('');
  };

  const addBot=()=>{
    if(!gameState||gameState.players.length>=6)return;
    const taken=gameState.players.filter(p=>p.isBot).map(p=>p.name);
    const name=BOT_NAMES.find(n=>!taken.includes(n))||`Bot${gameState.players.length}`;
    writeState(cur=>({...cur,players:[...cur.players,{id:'bot_'+Date.now(),name,isBot:true,hand:[],score:0,intelligence:2}],log:[...cur.log,{text:`${name} (bot) added.`,ts:Date.now()}]}));
  };

  const changeBotIntelligence=(botId,level)=>{
    writeState(cur=>({...cur,players:cur.players.map(p=>p.id===botId?{...p,intelligence:level}:p)}));
  };

  const startGame=()=>{
    if(!gameState||gameState.players.length<3){setError('Need at least 3 players');return;}
    writeState(cur=>({...cur,...dealAndFlip(cur.players,0,1,null)}));
    setScreen('game');setError('');
  };


  const playCard=id=>{
    if(!isMyTurn)return;
    const card=me.hand.find(c=>c.id===id);if(!card)return;
    const result=isLegal(card,top,gameState.riverSuit,gameState.riverLocked,gameState.pileReset);
    if(!result.legal)return;
    // If this 3 would block AND could also be played as a regular card, ask the player.
    if(result.blocks && regularPlay(card,top,gameState.riverSuit).legal){
      setBlockChoice({cardId:id});
      return;
    }
    writeState(cur=>applyMove(cur,myIdx,{action:'play',cardId:id}));
  };
  const confirmBlock=()=>{
    if(!blockChoice)return;
    const id=blockChoice.cardId;
    setBlockChoice(null);
    writeState(cur=>applyMove(cur,myIdx,{action:'play',cardId:id}));
  };
  const confirmRegular=()=>{
    if(!blockChoice)return;
    const id=blockChoice.cardId;
    setBlockChoice(null);
    writeState(cur=>applyMove(cur,myIdx,{action:'play',cardId:id,forceRegular:true}));
  };
  const drawCard=()=>{if(!isMyTurn||hasLegalPlay)return;writeState(cur=>applyMove(cur,myIdx,{action:'draw'}));};

  const doSwap=id=>{
    writeState(cur=>{
      if(cur.status!=='swap-decision')return cur;
      const wi=cur.players.findIndex(p=>p.id===cur.pendingSwapWinnerId);if(wi<0)return cur;
      const ps=[...cur.players];const pl={...ps[wi],hand:[...ps[wi].hand]};
      const ci=pl.hand.findIndex(c=>c.id===id);if(ci<0)return cur;
      const old=pl.hand.splice(ci,1)[0];const dk=[...cur.deck];const nc=dk.shift();pl.hand.push(nc);dk.push(old);ps[wi]=pl;
      const nt=dk.shift();
      const first=(cur.dealerIdx+1)%cur.players.length;
      return{...cur,players:ps,deck:dk,playPile:[],riverSuit:nt.suit,riverLocked:nt.rank==='J',riverCard:nt,pileReset:false,lastPlayedPlayerIdx:null,lastPlayedByIdx:null,pendingResetTarget:null,currentPlayerIdx:first,status:'playing',log:[...cur.log,{text:`${pl.name} swapped. ${cardName(nt)} sets river: ${nt.suit} ${SUIT_NAMES[nt.suit]}${nt.rank==='J'?' (LOCKED)':''}.`,ts:Date.now()}],pendingSwapWinnerId:null};
    });
  };
  const skipSwap=()=>{
    writeState(cur=>{
      if(cur.status!=='swap-decision')return cur;
      const dk=[...cur.deck];const nt=dk.shift();
      const first=(cur.dealerIdx+1)%cur.players.length;
      return{...cur,deck:dk,playPile:[],riverSuit:nt.suit,riverLocked:nt.rank==='J',riverCard:nt,pileReset:false,lastPlayedPlayerIdx:null,lastPlayedByIdx:null,pendingResetTarget:null,currentPlayerIdx:first,status:'playing',log:[...cur.log,{text:`${cardName(nt)} sets river: ${nt.suit} ${SUIT_NAMES[nt.suit]}${nt.rank==='J'?' (LOCKED)':''}.`,ts:Date.now()}],pendingSwapWinnerId:null};
    });
  };
  const startNextRound=()=>{
    writeState(cur=>{
      if(cur.status!=='round-end')return cur;
      return{...cur,...dealAndFlip(cur.players,cur.dealerIdx,cur.roundNumber+1,cur.pendingSwapWinnerId)};
    });
  };
  const newGame=()=>{
    setGameState(null);setRoomCode(null);setMode(null);setScreen('home');
    lastBellRef.current=0;lastSpecialRef.current=null;prevRoundKeyRef.current=null;prevTopIdRef.current=null;
  };

  const bg={minHeight:'100vh',background:'radial-gradient(ellipse at top,#1d3b2a 0%,#0a1a12 70%,#050a08 100%)',color:'#e8e2cd',fontFamily:'"Manrope",system-ui,sans-serif',position:'relative',overflow:'hidden'};

  // ── HOME ─────────────────────────────────────────────────────────────────────
  // First-load adult-language notice — shown over everything until acknowledged.
  if(showWarning)return(
    <div style={bg}><Style/>
      <AdultWarningModal kidMode={kidMode} onToggle={toggleKidMode} onContinue={dismissWarning}/>
    </div>
  );

  if(screen==='home')return(
    <div style={bg}><Style/>
      <div style={{maxWidth:520,margin:'0 auto',padding:'40px 22px'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{fontSize:13,letterSpacing:'0.4em',color:'#c9a961',marginBottom:8}}>A CARD GAME</div>
          <h1 className="display" style={{fontSize:'clamp(46px,12vw,76px)',margin:0,lineHeight:0.95,color:'#f5e9c8',fontWeight:500}}>
            Skip <em style={{color:'#c9a961',fontStyle:'italic'}}>the</em> River
          </h1>
          <div style={{marginTop:14,color:'#9aa39a',fontSize:14,fontStyle:'italic'}}>First to ten — and to win the round.</div>
        </div>
        <div style={panel}>
          <label style={{display:'block',fontSize:12,letterSpacing:'0.15em',color:'#c9a961',marginBottom:8}}>YOUR NAME</label>
          <input type="text" value={nameInput} onChange={e=>setNameInput(e.target.value.slice(0,16))} onBlur={()=>saveName(nameInput)} placeholder="e.g. Margaux" style={inputStyle}/>
        </div>
        <div style={{...panel,marginTop:14}}>
          <div style={sectionLabel}>PLAY ONLINE</div>
          <button style={primaryBtn} onClick={()=>{saveName(nameInput);createOnlineRoom();}}>Create Room</button>
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().slice(0,4))} placeholder="ROOM CODE" style={{...inputStyle,flex:1,textAlign:'center',letterSpacing:'0.3em',fontFamily:'Georgia,serif'}}/>
            <button style={secondaryBtn} onClick={()=>{saveName(nameInput);joinOnlineRoom();}}>Join</button>
          </div>
        </div>
        <div style={{...panel,marginTop:14}}>
          <div style={sectionLabel}>VS BOTS (OFFLINE)</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {[2,3,4,5].map(n=><button key={n} style={secondaryBtn} onClick={()=>{saveName(nameInput);startBotsGame(n);}}>{n} bots</button>)}
          </div>
        </div>
        {error&&<div style={errStyle}>{error}</div>}
        <div style={{textAlign:'center',marginTop:22,display:'flex',justifyContent:'center',gap:18,flexWrap:'wrap'}}>
          <button onClick={()=>setShowRules(true)} style={ghostBtn}>How to play →</button>
          <button onClick={()=>toggleKidMode(!kidMode)} style={ghostBtn}>
            Kid-friendly mode: <strong style={{color:kidMode?'#c9a961':'#9aa39a'}}>{kidMode?'ON':'OFF'}</strong>
          </button>
        </div>
        <div style={{textAlign:'center',marginTop:10,fontSize:11,color:'#5a6a5a',letterSpacing:'0.08em'}}>BUILD {APP_VERSION}</div>
      </div>
      {showRules&&<RulesModal onClose={()=>setShowRules(false)} kidMode={kidMode}/>}
    </div>
  );

  // ── LOBBY ────────────────────────────────────────────────────────────────────
  if(screen==='lobby'&&gameState){
    const isHost = mode==='bots' || gameState.hostId===playerId;
    return(
      <div style={bg}><Style/>
        <div style={{maxWidth:520,margin:'0 auto',padding:'32px 22px'}}>
          <button onClick={newGame} style={ghostBtn}>← back</button>
          <h2 className="display" style={{fontSize:36,color:'#f5e9c8',margin:'12px 0 4px',fontWeight:500}}>Lobby</h2>
          {mode==='online'&&(
            <div style={{...panel,textAlign:'center',marginBottom:12}}>
              <div style={{fontSize:11,letterSpacing:'0.3em',color:'#9aa39a'}}>ROOM CODE</div>
              <div style={{fontFamily:'Georgia,serif',fontSize:42,letterSpacing:'0.35em',color:'#c9a961',marginTop:4}}>{roomCode}</div>
              <div style={{fontSize:12,color:'#9aa39a'}}>Share this code with friends to join.</div>
            </div>
          )}
          <div style={panel}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={sectionLabel}>PLAYERS ({gameState.players.length}/6)</div>
              {/* Add bot button — visible to host in both online and bots mode */}
              {isHost&&gameState.players.length<6&&(
                <button style={{...secondaryBtn,padding:'6px 12px',fontSize:12}} onClick={addBot}>+ Add bot</button>
              )}
            </div>
            {gameState.players.map(p=>(
              <div key={p.id} style={{padding:'10px 0',borderBottom:'1px solid rgba(201,169,97,0.15)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:6}}>
                    <span style={{fontWeight:600}}>{p.name}</span>
                    {p.isBot&&<span style={{fontSize:11,color:'#c9a961',background:'rgba(201,169,97,0.15)',padding:'2px 6px',borderRadius:4}}>BOT</span>}
                    {p.isBot&&<span style={{fontSize:11,color:'#c9a961'}}>{BOT_INTEL_LABELS[p.intelligence??2]}</span>}
                    {p.id===gameState.hostId&&<span style={{fontSize:11,color:'#9aa39a'}}>host</span>}
                  </div>
                  {p.id===playerId&&<span style={{fontSize:11,color:'#c9a961'}}>you</span>}
                </div>
                {/* Inline skill selector for each bot — only the host can change it */}
                {p.isBot&&isHost&&(
                  <div style={{display:'flex',gap:6,marginTop:8}}>
                    {BOT_INTEL_LABELS.map((label,lvl)=>{
                      const active=(p.intelligence??2)===lvl;
                      return(
                        <button key={lvl} onClick={()=>changeBotIntelligence(p.id,lvl)} style={{
                          flex:1, height:48, borderRadius:8, fontSize:20,
                          cursor:'pointer', display:'flex', flexDirection:'column',
                          alignItems:'center', justifyContent:'center', gap:1,
                          background:active?'#c9a961':'rgba(201,169,97,0.08)',
                          border:`2px solid ${active?'#c9a961':'rgba(201,169,97,0.25)'}`,
                          boxShadow:active?'0 0 0 2px rgba(201,169,97,0.2)':'none',
                          color:active?'#0d0d0d':'#c9a961',
                        }}>
                          <span>{label.split(' ')[0]}</span>
                          <span style={{fontSize:7,letterSpacing:'0.05em',fontWeight:active?700:400,opacity:0.8}}>
                            {label.split(' ').slice(1).join(' ').toUpperCase()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {gameState.players.length<3&&<div style={{marginTop:10,fontSize:12,color:'#9aa39a',fontStyle:'italic'}}>Need at least 3 players. Add bots or invite friends.</div>}
          </div>
          {isHost
            ?<button style={{...primaryBtn,marginTop:14,opacity:gameState.players.length>=3?1:0.5}} onClick={startGame} disabled={gameState.players.length<3}>Start Game {gameState.players.length<3&&'(need 3+)'}</button>
            :<div style={{textAlign:'center',marginTop:18,color:'#9aa39a',fontStyle:'italic'}}>Waiting for host to start…</div>
          }
          {error&&<div style={errStyle}>{error}</div>}
          <div style={{textAlign:'center',marginTop:22}}><button onClick={()=>setShowRules(true)} style={ghostBtn}>Rules</button></div>
          <div style={{textAlign:'center',marginTop:8,fontSize:11,color:'#5a6a5a',letterSpacing:'0.08em'}}>BUILD {APP_VERSION}</div>
        </div>
        {showRules&&<RulesModal onClose={()=>setShowRules(false)} kidMode={kidMode}/>}
      </div>
    );
  }

  // ── GAME ─────────────────────────────────────────────────────────────────────
  if(gameState&&['playing','swap-decision','round-end','game-over'].includes(gameState.status)){
    const hasBots=gameState.players.some(p=>p.isBot);
    const riverCard=gameState.riverCard;
    return(
      <div style={bg}><Style/>
        <div style={{maxWidth:720,margin:'0 auto',padding:'14px 12px 200px'}}>

          {/* Header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <button onClick={newGame} style={ghostBtn}>menu</button>
            <div style={{fontSize:10,letterSpacing:'0.3em',color:'#9aa39a',textAlign:'center'}}>ROUND {gameState.roundNumber}</div>
            <button onClick={()=>setShowRules(true)} style={ghostBtn}>rules</button>
          </div>

          {/* Bot speed slider */}
          {hasBots&&gameState.status==='playing'&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:10,fontSize:11,color:'#9aa39a'}}>
              <span style={{letterSpacing:'0.12em'}}>BOT SPEED</span>
              <input type="range" min={0} max={4} value={botSpeed} onChange={e=>setBotSpeed(+e.target.value)} style={{width:80,accentColor:'#c9a961',cursor:'pointer'}}/>
              <span style={{color:'#e8e2cd',minWidth:58}}>{BOT_SPEED_LABELS[botSpeed]}</span>
            </div>
          )}

          {/* Other players — visual card stacks */}
          <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:6,marginBottom:10}}>
            {gameState.players.filter((_,i)=>i!==myIdx).map(p=>{
              const idx=gameState.players.findIndex(x=>x.id===p.id);
              const isTurn=gameState.currentPlayerIdx===idx&&gameState.status==='playing';
              return <OtherPlayer key={p.id} p={p} isTurn={isTurn}/>;
            })}
          </div>

          {/* Play area */}
          <div style={{position:'relative',background:'radial-gradient(ellipse at center,rgba(30,65,45,0.55) 0%,rgba(10,22,16,0.35) 80%)',border:'1px solid rgba(201,169,97,0.2)',borderRadius:14,padding:'20px 18px 16px',marginBottom:12,minHeight:200}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'center',gap:20}}>

              {/* Deck */}
              <div style={{textAlign:'center',flexShrink:0,paddingTop:10}}>
                <Card faceDown size="sm"/>
                <div style={{fontSize:10,color:'#7a8a7a',marginTop:5,letterSpacing:'0.1em'}}>DECK<br/>{gameState.deck.length}</div>
              </div>

              {/* Top card — hero */}
              <div style={{textAlign:'center',flexShrink:0}}>
                <div key={topCardAnimKey} className={topCardAnimKey>0?(cardAnimDir==='above'?'card-from-above':'card-from-below'):''}>
                  {top?<Card card={top} size="lg"/>:<div style={{width:CARD_SIZES.lg.w,height:CARD_SIZES.lg.h,border:'2px dashed rgba(201,169,97,0.2)',borderRadius:9}}/>}
                </div>
                <div style={{marginTop:7}}>
                  <div style={{fontSize:10,letterSpacing:'0.15em',fontWeight:700,color:(!top||gameState.pileReset)?'#c9a961':'#7a8a7a'}}>
                    {!top?'PLAY ANYTHING':gameState.pileReset?'PLAY ANYTHING':'TO BEAT'}
                  </div>
                </div>
              </div>

              {/* River card — shows what set the river */}
              {riverCard&&(
                <div style={{textAlign:'center',flexShrink:0,paddingTop:10}}>
                  <div style={{position:'relative',display:'inline-block'}}>
                    <Card card={riverCard} size="sm"/>
                    {riverCard.id!==top?.id&&(
                      <div style={{position:'absolute',inset:-3,borderRadius:CARD_SIZES.sm.r+3,border:`2px solid ${isRed(riverCard.suit)?'rgba(192,57,43,0.55)':'rgba(201,169,97,0.45)'}`,pointerEvents:'none'}}/>
                    )}
                  </div>
                  <div style={{fontSize:10,letterSpacing:'0.12em',color:'#c9a961',marginTop:5,fontWeight:700}}>
                    RIVER{gameState.riverLocked?' 🔒':''}
                  </div>
                  <div style={{fontSize:10,fontFamily:'"Georgia",serif',color:isRed(riverCard.suit)?'#c0392b':'#d4cfbf',marginTop:2}}>
                    {SUIT_NAMES[riverCard.suit]}
                  </div>
                </div>
              )}
            </div>

            {/* River flip ceremony */}
            {riverFlipPhase!=='done'&&(
              <div style={{
                position:'absolute',inset:0,borderRadius:14,
                background:riverFlipPhase==='flying'?'rgba(5,18,10,0)':'rgba(5,18,10,0.9)',
                transition:riverFlipPhase==='flying'?'background 0.55s ease':'none',
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                gap:20,zIndex:5,
              }}>
                {/* Fly-to-corner wrapper: after reveal, card shrinks toward the river pile */}
                <div style={{
                  transition: riverFlipPhase==='flying'
                    ? 'transform 0.65s cubic-bezier(0.4,0,1,0.8), opacity 0.45s 0.1s ease'
                    : 'none',
                  // Move right (toward river corner column) and slightly up, while shrinking
                  transform: riverFlipPhase==='flying' ? 'translate(110px,-30px) scale(0.28)' : 'none',
                  opacity: riverFlipPhase==='flying' ? 0 : 1,
                  transformOrigin: 'center center',
                }}>
                  <div style={{perspective:900}}>
                    <div style={{
                      width:CARD_SIZES.xl.w,height:CARD_SIZES.xl.h,
                      position:'relative',transformStyle:'preserve-3d',
                      transition:'transform 1.1s cubic-bezier(0.4,0.1,0.3,1)',
                      transform:riverFlipPhase==='facedown'?'rotateY(0deg)':'rotateY(180deg)',
                    }}>
                      <div style={{position:'absolute',inset:0,backfaceVisibility:'hidden',WebkitBackfaceVisibility:'hidden'}}><Card faceDown size="xl"/></div>
                      <div style={{position:'absolute',inset:0,backfaceVisibility:'hidden',WebkitBackfaceVisibility:'hidden',transform:'rotateY(180deg)'}}>{riverCard&&<Card card={riverCard} size="xl"/>}</div>
                    </div>
                  </div>
                </div>

                {/* "River is…" text — shown on revealed, fades on flying */}
                {(riverFlipPhase==='revealed'||riverFlipPhase==='flying')&&(
                  <div style={{
                    textAlign:'center',
                    animation: riverFlipPhase==='revealed'?'fadein 0.5s ease':undefined,
                    transition:'opacity 0.3s ease',
                    opacity: riverFlipPhase==='flying'?0:1,
                  }}>
                    <div style={{fontSize:'clamp(13px,3.5vw,18px)',color:'#9aa39a',letterSpacing:'0.15em',marginBottom:6}}>
                      {cardName(riverCard)} sets the river
                    </div>
                    <div style={{fontSize:'clamp(36px,10vw,56px)',color:isRed(gameState.riverSuit)?'#f87171':'#f0ece0',fontFamily:'"Georgia",serif',lineHeight:1,filter:`drop-shadow(0 0 16px ${isRed(gameState.riverSuit)?'rgba(248,113,113,0.7)':'rgba(240,236,224,0.5)'})`}}>
                      {gameState.riverSuit} {SUIT_NAMES[gameState.riverSuit]}
                    </div>
                    {gameState.riverLocked&&<div style={{fontSize:12,color:'#9aa39a',marginTop:8,letterSpacing:'0.2em'}}>🔒 LOCKED FOR THIS ROUND</div>}
                  </div>
                )}
              </div>
            )}

            {/* Special-move overlay */}
            {specialAnnounce&&(
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',background:'rgba(10,20,15,0.82)',borderRadius:14,animation:'fadein 0.2s ease',zIndex:6}}>
                <div style={{textAlign:'center',padding:18}}>
                  <div className="display" style={{fontSize:'clamp(26px,7vw,42px)',fontWeight:500,color:specialAnnounce.kind==='skip'?'#c9a961':'#f87171',letterSpacing:1}}>
                    {specialAnnounce.kind==='skip'?'🔔 SKIP THE RIVER':(kidMode?'C-WORD IN THE RIVER':'CUNT IN THE RIVER')}
                  </div>
                  <div style={{color:'#e8e2cd',marginTop:6,fontStyle:'italic'}}>by {specialAnnounce.by}</div>
                  {specialAnnounce.kind==='skip'&&<div style={{color:'#9aa39a',marginTop:8,fontSize:12}}>tap a glass!</div>}
                </div>
              </div>
            )}
          </div>

          {gameState.status==='swap-decision'&&<SwapPhase gameState={gameState} playerId={playerId} onSwap={doSwap} onSkip={skipSwap}/>}
          {gameState.status==='round-end'&&<RoundEndPanel gameState={gameState} onNext={startNextRound} isHost={gameState.hostId===playerId}/>}
          {gameState.status==='game-over'&&<GameOverPanel gameState={gameState} onNew={newGame} playerId={playerId}/>}

          {/* My hand */}
          {gameState.status==='playing'&&me&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,padding:'0 4px'}}>
                <div style={{fontSize:12,letterSpacing:'0.15em',color:'#c9a961'}}>YOUR HAND · {me.hand.length} · {me.score} pts</div>
                <div style={{fontSize:12,color:isMyTurn&&riverFlipPhase==='done'?'#c9a961':'#9aa39a'}}>
                  {isMyTurn&&riverFlipPhase==='done'?'● YOUR TURN':`waiting for ${gameState.players[gameState.currentPlayerIdx]?.name}…`}
                </div>
              </div>
              <HandRow hand={me.hand} top={top} riverSuit={gameState.riverSuit} riverLocked={gameState.riverLocked} pileReset={gameState.pileReset} isMyTurn={isMyTurn&&riverFlipPhase==='done'} onPlay={playCard}/>
              {/* Block-or-regular choice prompt — shown when a 3 is played on a river card
                  and the player has the option to play it as a regular value-3 card instead. */}
              {blockChoice&&(()=>{
                const bc=me?.hand.find(c=>c.id===blockChoice.cardId);
                return bc?(
                  <div style={{marginTop:10,background:'rgba(201,169,97,0.1)',border:'1px solid rgba(201,169,97,0.45)',borderRadius:8,padding:'12px 14px',animation:'fadein 0.2s ease'}}>
                    <div style={{fontSize:12,color:'#c9a961',fontWeight:700,letterSpacing:'0.1em',marginBottom:8}}>
                      {cardName(bc)} — choose how to play it:
                    </div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button onClick={confirmBlock} style={{...secondaryBtn,flex:1}}>
                        🛡 Block — pile resets
                      </button>
                      <button onClick={confirmRegular} style={{...secondaryBtn,flex:1}}>
                        ▶ Play as regular (value 3)
                      </button>
                    </div>
                  </div>
                ):null;
              })()}
              {/* Draw button — only usable when no legal play exists (per the rules).
                  Always occupies layout space so the activity log below never jumps. */}
              <button onClick={drawCard} disabled={hasLegalPlay||!!blockChoice}
                style={{
                  ...secondaryBtn, marginTop:10,
                  visibility:(isMyTurn&&riverFlipPhase==='done')?'visible':'hidden',
                  pointerEvents:(isMyTurn&&riverFlipPhase==='done'&&!hasLegalPlay&&!blockChoice)?'auto':'none',
                  opacity:(hasLegalPlay||blockChoice)?0.4:1,
                  cursor:(hasLegalPlay||blockChoice)?'not-allowed':'pointer',
                }}
              >
                {hasLegalPlay?'You must play a card':(gameState.deck.length>0?'Draw a card':'Pass (deck empty)')}
              </button>
            </div>
          )}

          {/* Activity log — chronological, auto-scrolls to newest at bottom */}
          <div style={{marginTop:18,...panel}}>
            <div style={sectionLabel}>ACTIVITY</div>
            <div ref={logRef} style={{maxHeight:180,overflowY:'auto',scrollBehavior:'smooth'}}>
              {(gameState.log||[]).map((l,i)=>(
                <div key={i} style={{fontSize:12,color:'#bdb89c',padding:'3px 0',borderBottom:'1px solid rgba(201,169,97,0.05)'}}>{renderLog(censor(l.text,kidMode))}</div>
              ))}
            </div>
          </div>
        </div>
        {showRules&&<RulesModal onClose={()=>setShowRules(false)} kidMode={kidMode}/>}
      </div>
    );
  }

  return <div style={bg}><Style/></div>;
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function HandRow({hand,top,riverSuit,riverLocked,pileReset,isMyTurn,onPlay}){
  const [kqToast,   setKqToast]   = useState(false);
  const [hoverKQId, setHoverKQId] = useState(null);
  const kqTimerRef = useRef(null);

  const legalIds = new Set(
    isMyTurn ? hand.filter(c=>isLegal(c,top,riverSuit,riverLocked,pileReset).legal).map(c=>c.id) : []
  );
  const sorted = [...hand].sort((a,b)=>{const s=SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit);return s!==0?s:a.value-b.value;});

  // True only when this specific card is illegal *because* of the K=Q equality rule:
  // must be a cross-rank play (K on Q or Q on K), same-value collision, and not the
  // one legal exception (river King on non-river Queen).
  const isKQConflict = c => {
    if (!top || !isMyTurn || pileReset) return false;
    if (!((c.rank==='K'&&top.rank==='Q')||(c.rank==='Q'&&top.rank==='K'))) return false;
    return !isLegal(c,top,riverSuit,riverLocked,pileReset).legal;
  };

  const triggerKQToast = () => {
    setKqToast(true);
    clearTimeout(kqTimerRef.current);
    kqTimerRef.current = setTimeout(()=>setKqToast(false), 2800);
  };

  return(
    <div style={{position:'relative'}}>
      <div style={{display:'flex',overflowX:'auto',overflowY:'visible',padding:'14px 4px 20px',gap:5,scrollbarWidth:'none',msOverflowStyle:'none'}} className="hide-scrollbar">
        {sorted.map(c=>{
          const legal      = legalIds.has(c.id);
          const kqConflict = isKQConflict(c);
          return(
            <div key={c.id} style={{flex:'0 0 auto',position:'relative'}}
              onMouseEnter={()=>{ if(kqConflict) setHoverKQId(c.id); }}
              onMouseLeave={()=>{ if(hoverKQId===c.id) setHoverKQId(null); }}
            >
              <Card card={c} size="md"
                onClick={
                  legal        ? ()=>onPlay(c.id) :
                  kqConflict   ? triggerKQToast   :
                  undefined
                }
                dimmed={isMyTurn&&!legal} highlighted={legal}
              />

              {/* Desktop hover tooltip — only for the K=Q conflict case */}
              {hoverKQId===c.id && (
                <div style={{
                  position:'absolute', bottom:'calc(100% + 10px)',
                  left:'50%', transform:'translateX(-50%)',
                  background:'rgba(5,15,10,0.97)',
                  border:'1px solid rgba(201,169,97,0.45)',
                  borderRadius:7, padding:'8px 11px',
                  fontSize:11, lineHeight:1.55,
                  color:'#e8e2cd', whiteSpace:'nowrap',
                  zIndex:60, pointerEvents:'none',
                  boxShadow:'0 4px 16px rgba(0,0,0,0.55)',
                  textAlign:'center',
                }}>
                  <div style={{color:'#c9a961',fontWeight:700,marginBottom:3}}>👑 Kings = Queens in value</div>
                  A King can only beat a Queen when<br/>
                  the King is the river suit and the Queen isn't.
                  {/* Little downward arrow */}
                  <div style={{
                    position:'absolute', top:'100%', left:'50%',
                    transform:'translateX(-50%)',
                    width:0, height:0,
                    borderLeft:'6px solid transparent',
                    borderRight:'6px solid transparent',
                    borderTop:'6px solid rgba(201,169,97,0.45)',
                  }}/>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile tap-triggered toast — slides up from below the hand */}
      {kqToast && (
        <div style={{
          position:'absolute', bottom:0, left:'50%',
          transform:'translateX(-50%)',
          background:'linear-gradient(135deg,rgba(20,32,24,0.98),rgba(10,20,14,0.98))',
          border:'1px solid rgba(201,169,97,0.5)',
          borderRadius:9, padding:'10px 16px',
          fontSize:13, lineHeight:1.5,
          color:'#e8e2cd', whiteSpace:'nowrap',
          zIndex:60, pointerEvents:'none',
          boxShadow:'0 4px 20px rgba(0,0,0,0.6)',
          animation:'fadein 0.2s ease',
          textAlign:'center',
        }}>
          <div style={{color:'#c9a961',fontWeight:700,marginBottom:2}}>👑 Kings and Queens are equal value</div>
          A King only beats a Queen when the King<br/>is the river suit and the Queen isn't.
        </div>
      )}
    </div>
  );
}

function SwapPhase({gameState,playerId,onSwap,onSkip}){
  const winner=gameState.players.find(p=>p.id===gameState.pendingSwapWinnerId);
  const isMe=gameState.pendingSwapWinnerId===playerId;
  if(!winner)return null;
  return(
    <div style={{...panel,marginBottom:12}}>
      <div style={sectionLabel}>SWAP PHASE</div>
      <div style={{fontSize:13,color:'#bdb89c',marginBottom:10}}>
        {isMe?'You won the last round. Swap one card from your hand with the top of the deck — or skip.':
              `${winner.name} won the last round and is deciding whether to swap…`}
      </div>
      {isMe&&<>
        <HandRow hand={winner.hand} top={null} riverSuit={null} riverLocked={false} pileReset isMyTurn onPlay={onSwap}/>
        <button style={{...secondaryBtn,marginTop:8}} onClick={onSkip}>Skip swap</button>
      </>}
    </div>
  );
}

function RoundEndPanel({gameState,onNext,isHost}){
  const ordered=[...gameState.players].sort((a,b)=>(b.score||0)-(a.score||0));
  return(
    <div style={{...panel,marginBottom:12}}>
      <div className="display" style={{fontSize:28,color:'#f5e9c8',marginBottom:8,fontWeight:500}}>Round {gameState.roundNumber} done</div>
      {ordered.map((p,i)=>(
        <div key={p.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid rgba(201,169,97,0.1)'}}>
          <div>{i===0&&'🏆 '}{p.name}{p.isBot&&' 🤖'}{p.finishedRank===0&&<span style={{color:'#c9a961',marginLeft:6,fontSize:12}}>+3</span>}{p.finishedRank===1&&<span style={{color:'#c9a961',marginLeft:6,fontSize:12}}>+1</span>}</div>
          <div style={{color:'#c9a961',fontFamily:'Georgia,serif'}}>{p.score||0} pts</div>
        </div>
      ))}
      {(gameState.streak?.count>=2)&&<div style={{marginTop:10,fontSize:12,color:'#e07878',fontStyle:'italic'}}>{gameState.players.find(p=>p.id===gameState.streak.playerId)?.name} on a {gameState.streak.count}-round streak…</div>}
      {isHost?<button style={{...primaryBtn,marginTop:12}} onClick={onNext}>Next round →</button>:<div style={{marginTop:10,color:'#9aa39a',fontStyle:'italic',fontSize:13}}>Waiting for host to start next round…</div>}
    </div>
  );
}

const CONFETTI_COLORS=['#c9a961','#f5e9c8','#e07878','#7ec98f','#6fa8dc','#f0c060','#d98ad9'];

// Falling confetti layer. `count` scales the spectacle (bigger when you win).
function Confetti({count}){
  const pieces=useMemo(()=>Array.from({length:count},(_,i)=>({
    left:Math.random()*100,
    delay:Math.random()*0.8,
    dur:2.6+Math.random()*2.4,
    size:6+Math.random()*8,
    color:CONFETTI_COLORS[i%CONFETTI_COLORS.length],
    round:Math.random()<0.4,
  })),[count]);
  return(
    <div style={{position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none'}}>
      {pieces.map((p,i)=>(
        <div key={i} style={{
          position:'absolute',top:0,left:`${p.left}%`,
          width:p.size,height:p.round?p.size:p.size*1.6,
          background:p.color,borderRadius:p.round?'50%':2,
          animation:`confetti-fall ${p.dur}s linear ${p.delay}s infinite`,
        }}/>
      ))}
    </div>
  );
}

// Full-screen win celebration. Big for any winner, bigger still when it's you.
function WinCelebration({youWon,winner,roundNumber,onNew}){
  return(
    <div style={{position:'fixed',inset:0,zIndex:150,display:'flex',alignItems:'center',justifyContent:'center',padding:16,
      background:'radial-gradient(ellipse at center,rgba(10,25,16,0.86) 0%,rgba(5,10,8,0.96) 75%)',animation:'fadein 0.3s ease'}}>
      <Confetti count={youWon?150:70}/>
      <div style={{position:'relative',textAlign:'center',maxWidth:480}}>
        {youWon&&(
          <div style={{position:'absolute',inset:'-10% -20% auto',display:'flex',justifyContent:'space-between',fontSize:38,pointerEvents:'none'}}>
            <span style={{animation:'float-emoji 2.2s ease-in-out infinite'}}>🎉</span>
            <span style={{animation:'float-emoji 2.6s ease-in-out 0.4s infinite'}}>🎊</span>
          </div>
        )}
        <div style={{fontSize:youWon?100:64,lineHeight:1,animation:'trophy-pop 0.7s cubic-bezier(0.2,0.8,0.3,1.2) both'}}>🏆</div>
        <div style={{fontSize:youWon?14:12,letterSpacing:'0.4em',color:'#c9a961',margin:'10px 0 4px'}}>{youWon?'VICTORY':'GAME OVER'}</div>
        <div className="display" style={{
          fontSize:youWon?'clamp(52px,15vw,92px)':'clamp(38px,10vw,60px)',
          color:'#f5e9c8',fontWeight:600,lineHeight:1,
          animation:youWon
            ?'banner-rise 0.5s ease both, win-glow 1.8s ease 0.5s infinite, you-win-pulse 2s ease 0.6s infinite'
            :'banner-rise 0.5s ease both, win-glow 2.6s ease 0.5s infinite',
        }}>
          {youWon?'YOU WIN!':`${winner?.name} wins`}
        </div>
        <div style={{color:'#9aa39a',marginTop:12,fontSize:youWon?16:14}}>{winner?.score} points · {roundNumber} rounds</div>
        <button style={{...primaryBtn,marginTop:22,width:'auto',padding:'12px 32px'}} onClick={onNew}>New game</button>
      </div>
    </div>
  );
}

function GameOverPanel({gameState,onNew,playerId}){
  const winner=gameState.players.find(p=>p.id===gameState.gameWinnerId);
  return <WinCelebration youWon={winner?.id===playerId} winner={winner} roundNumber={gameState.roundNumber} onNew={onNew}/>;
}

function AdultWarningModal({kidMode,onToggle,onContinue}){
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}>
      <div style={{background:'#1a2a20',border:'1px solid rgba(201,169,97,0.3)',borderRadius:12,padding:'26px 24px',maxWidth:440,color:'#e8e2cd',textAlign:'center'}}>
        <div style={{fontSize:34,marginBottom:4}}>⚠️</div>
        <div className="display" style={{fontSize:26,color:'#f5e9c8',marginBottom:10,fontWeight:500}}>Adult language</div>
        <p style={{fontSize:14,lineHeight:1.6,color:'#bdb89c',margin:'0 0 4px'}}>
          Skip the River contains adult language — including a card move whose traditional name is a strong swear word. Turn on <strong style={{color:'#f5e9c8'}}>kid-friendly mode</strong> to replace it with a clean version.
        </p>
        <button
          onClick={()=>onToggle(!kidMode)}
          style={{
            display:'inline-flex',alignItems:'center',gap:10,margin:'18px 0',cursor:'pointer',
            background:kidMode?'rgba(201,169,97,0.18)':'rgba(0,0,0,0.3)',
            border:`1.5px solid ${kidMode?'#c9a961':'rgba(201,169,97,0.4)'}`,
            borderRadius:999,color:'#f5e9c8',fontSize:14,fontWeight:600,padding:'9px 16px',
          }}
        >
          Kid-friendly mode: <strong style={{color:kidMode?'#c9a961':'#9aa39a'}}>{kidMode?'ON':'OFF'}</strong>
        </button>
        <button style={primaryBtn} onClick={onContinue}>Enter game</button>
      </div>
    </div>
  );
}

function RulesModal({onClose,kidMode}){
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#1a2a20',border:'1px solid rgba(201,169,97,0.3)',borderRadius:12,padding:22,maxWidth:540,maxHeight:'85vh',overflowY:'auto',color:'#e8e2cd'}}>
        <div className="display" style={{fontSize:28,color:'#f5e9c8',marginBottom:12,fontWeight:500}}>How to play</div>
        <div style={{fontSize:14,lineHeight:1.7}}>
          <p><strong style={{color:'#c9a961'}}>Setup.</strong> 3–6 players, one standard deck (no jokers). Deal 9 cards each for 3 players, 7 each for 4, or 6 each for 5–6. The rest form the face-down pile. Be first to get rid of all your cards.</p>
          <p><strong style={{color:'#c9a961'}}>Starting a round.</strong> A card is flipped to determine the river suit only — it does not start play. (If that flipped card is a Jack, its suit is the river and is locked for the whole round.) The player to the left of the dealer goes first and may play any card they like. That card opens the round.</p>
          <p><strong style={{color:'#c9a961'}}>Each turn</strong> play a card that: matches the suit with a higher value, matches the value with a different suit, or is any river-suit card (beats any non-river card regardless of value). If you can't, draw one or pass if the deck is empty.</p>
          <p><strong style={{color:'#c9a961'}}>Full-table pass.</strong> If the player who set the current card to beat is come back around to after all other active players have drawn or passed, that player is not obliged to beat their own card. Instead, the pile resets and they may play any card they like.</p>
          <p><strong style={{color:'#c9a961'}}>3:</strong> Blocks any river card except an Ace. Pile resets — next player plays anything. A Three of the river suit can also be played as a regular river card (value 3), or as a plain Three to beat a Two of the same suit or to match another Three already played as a regular card.</p>
          <p><strong style={{color:'#c9a961'}}>Jack:</strong> Changes the river suit. Only playable if the top card is a Jack or lower. A river-suit Jack plays as a normal card (can't change the river to the same suit).</p>
          <p><strong style={{color:'#c9a961'}}>King = Queen value.</strong> A King cannot be played against a Queen as they are the same value — unless the Queen is a non-river card and the King is a river card.</p>
          <p><strong style={{color:'#c9a961'}}>Ace:</strong> Highest card. Cannot be blocked by a Three.</p>
          <p><strong style={{color:'#c9a961'}}>Scoring:</strong> 1st out +3 pts, 2nd out +1 pt. Last player holding cards deals next round.</p>
          <p><strong style={{color:'#c9a961'}}>Swap (round 2+):</strong> The previous round's winner may swap one hand card for the top of the deck before the river card is flipped.</p>
          <p><strong style={{color:'#c9a961'}}>Skip the River:</strong> Playing a Jack on a river card to change the suit — at least one player must tap something that makes a pleasant ringing sound. 🔔</p>
          <p><strong style={{color:'#c9a961'}}>{kidMode?'C-word in the River':'Cunt in the River'}:</strong> Playing a Jack on a non-river card whose suit matches the Jack, thereby making the card being played against a river card for the next player.</p>
          <p><strong style={{color:'#c9a961'}}>Free Dinner:</strong> Win 4 rounds in a row and the remaining players must provide that player with a free dinner.</p>
          <p><strong style={{color:'#c9a961'}}>Cheating:</strong> You can cheat if, after the fact, everyone agrees it was pretty funny.</p>
        </div>
        <button style={{...secondaryBtn,marginTop:14,width:'100%'}} onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

function Style(){
  return(
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
      body{margin:0;}
      .display{font-family:'Fraunces','Georgia',serif;font-variation-settings:"opsz" 144;}
      @keyframes fadein{from{opacity:0;transform:scale(0.96);}to{opacity:1;transform:scale(1);}}
      @keyframes card-from-below-kf{from{transform:translateY(60px) scale(0.82);opacity:0;}to{transform:translateY(0) scale(1);opacity:1;}}
      @keyframes card-from-above-kf{from{transform:translateY(-60px) scale(0.82);opacity:0;}to{transform:translateY(0) scale(1);opacity:1;}}
      .card-from-below{animation:card-from-below-kf 0.45s cubic-bezier(0.2,0,0.3,1);}
      .card-from-above{animation:card-from-above-kf 0.45s cubic-bezier(0.2,0,0.3,1);}
      @keyframes confetti-fall{0%{transform:translateY(-15vh) rotate(0deg);opacity:1;}100%{transform:translateY(115vh) rotate(720deg);opacity:0.85;}}
      @keyframes trophy-pop{0%{transform:scale(0) rotate(-35deg);opacity:0;}55%{transform:scale(1.3) rotate(10deg);}100%{transform:scale(1) rotate(0deg);opacity:1;}}
      @keyframes banner-rise{from{transform:translateY(40px) scale(0.85);opacity:0;}to{transform:translateY(0) scale(1);opacity:1;}}
      @keyframes win-glow{0%,100%{text-shadow:0 0 18px rgba(201,169,97,0.45);}50%{text-shadow:0 0 38px rgba(201,169,97,0.95),0 0 70px rgba(201,169,97,0.6);}}
      @keyframes you-win-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.05);}}
      @keyframes float-emoji{0%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-12px) rotate(8deg);}100%{transform:translateY(0) rotate(0deg);}}
      input:focus{outline:none;border-color:#c9a961!important;}
      button:active{transform:translateY(1px);}
      ::-webkit-scrollbar{height:6px;width:6px;}
      ::-webkit-scrollbar-thumb{background:rgba(201,169,97,0.3);border-radius:3px;}
      .hide-scrollbar::-webkit-scrollbar{display:none;}
      input[type=range]{-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:rgba(201,169,97,0.25);outline:none;}
      input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#c9a961;cursor:pointer;}
      input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#c9a961;cursor:pointer;border:none;}
    `}</style>
  );
}

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────
const panel={background:'linear-gradient(180deg,rgba(20,32,24,0.85) 0%,rgba(13,22,17,0.85) 100%)',border:'1px solid rgba(201,169,97,0.2)',borderRadius:10,padding:'14px 16px'};
const sectionLabel={fontSize:11,letterSpacing:'0.25em',color:'#c9a961',marginBottom:10,fontWeight:600};
const inputStyle={width:'100%',background:'rgba(0,0,0,0.3)',border:'1.5px solid rgba(201,169,97,0.3)',borderRadius:6,color:'#f5e9c8',fontSize:16,padding:'10px 12px',fontFamily:'inherit'};
const primaryBtn={width:'100%',background:'linear-gradient(180deg,#c9a961 0%,#a88947 100%)',border:'none',borderRadius:6,color:'#1a1206',fontSize:15,fontWeight:700,letterSpacing:'0.1em',padding:'12px 14px',cursor:'pointer',textTransform:'uppercase',boxShadow:'0 3px 10px rgba(201,169,97,0.25)'};
const secondaryBtn={background:'rgba(201,169,97,0.1)',border:'1.5px solid rgba(201,169,97,0.4)',borderRadius:6,color:'#f5e9c8',fontSize:14,fontWeight:600,padding:'10px 14px',cursor:'pointer'};
const ghostBtn={background:'transparent',border:'none',color:'#9aa39a',fontSize:13,cursor:'pointer',padding:4};
const errStyle={marginTop:12,padding:10,background:'rgba(224,120,120,0.1)',border:'1px solid rgba(224,120,120,0.4)',borderRadius:6,color:'#e07878',fontSize:13,textAlign:'center'};
