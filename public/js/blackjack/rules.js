// Blackjack rules and basic strategy.
// Table rules: 6 decks, dealer stands on all 17s, blackjack pays 3 to 2, double on any two cards,
// double after split, split up to four hands, split aces get one card each, insurance pays 2 to 1,
// dealer peeks for blackjack. Late surrender is optional.

import { newDeck, shuffle } from '../cards.js';

export const RULES = { decks: 6, penetration: 0.75, minBet: 10, maxBet: 500, maxHands: 4 };

export const cardValue = c => (c.r === 14 ? 11 : c.r >= 10 ? 10 : c.r);
export const isTen = c => c.r >= 10 && c.r <= 13;

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c); if (c.r === 14) aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 && total <= 21 };
}
export const isBlackjack = (cards, fromSplit = false) => !fromSplit && cards.length === 2 && handValue(cards).total === 21;
export const isPair = cards => cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);

export function describeTotal(cards, fromSplit) {
  const v = handValue(cards);
  if (isBlackjack(cards, fromSplit)) return 'Blackjack';
  if (v.total > 21) return `Bust (${v.total})`;
  return v.soft ? `Soft ${v.total}` : String(v.total);
}

export class Shoe {
  constructor(decks = RULES.decks) { this.decks = decks; this.reshuffle(); }
  reshuffle() {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) this.cards.push(...newDeck());
    shuffle(this.cards);
    // the cut card goes about three-quarters of the way in
    this.cut = Math.floor(this.cards.length * (1 - RULES.penetration));
    this.dealt = 0; this.needsShuffle = false; this.fresh = true;
  }
  draw() {
    if (!this.cards.length) this.reshuffle();
    const c = this.cards.pop(); this.dealt++;
    if (this.cards.length <= this.cut) this.needsShuffle = true;
    return c;
  }
  get remainingDecks() { return this.cards.length / 52; }
}

// ---------- basic strategy ----------
// up: dealer upcard value 2..11 (11 = ace). Returns 'H' hit, 'S' stand, 'D' double (else hit),
// 'Ds' double (else stand), 'P' split, 'R' surrender (else hit), 'Rs' (else stand).
export function chartAction(cards, up, { noPair = false } = {}) {
  const v = handValue(cards);
  if (!noPair && isPair(cards)) {
    const p = cardValue(cards[0]);
    const split = {
      11: true, 10: false, 9: ![7, 10, 11].includes(up), 8: true,
      7: up <= 7, 6: up <= 6, 5: false, 4: up === 5 || up === 6, 3: up <= 7, 2: up <= 7,
    }[p];
    if (split) return 'P';
  }
  if (v.soft) {
    const t = v.total;
    if (t >= 19) return 'S';
    if (t === 18) return up >= 3 && up <= 6 ? 'Ds' : up <= 8 ? 'S' : 'H';
    if (t === 17) return up >= 3 && up <= 6 ? 'D' : 'H';
    if (t === 15 || t === 16) return up >= 4 && up <= 6 ? 'D' : 'H';
    if (t === 13 || t === 14) return up >= 5 && up <= 6 ? 'D' : 'H';
    return 'H';
  }
  const t = v.total;
  if (t >= 17) return 'S';
  if (t === 16) return up >= 9 ? 'R' : up <= 6 ? 'S' : 'H';
  if (t === 15) return up === 10 ? 'R' : up <= 6 ? 'S' : 'H';
  if (t >= 13) return up <= 6 ? 'S' : 'H';
  if (t === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
  if (t === 11) return up <= 10 ? 'D' : 'H';
  if (t === 10) return up <= 9 ? 'D' : 'H';
  if (t === 9) return up >= 3 && up <= 6 ? 'D' : 'H';
  return 'H';
}

// The best legal action given what's allowed right now.
// allowed: { double, split, surrender }
export function bestAction(cards, up, allowed, opts = {}) {
  let a = chartAction(cards, up, opts);
  if (a === 'P' && !allowed.split) a = chartAction(cards, up, { noPair: true }); // no more splits allowed: play the total
  if (a === 'R' || a === 'Rs') a = allowed.surrender ? 'R' : 'H';
  if (a === 'D') a = allowed.double ? 'D' : 'H';
  if (a === 'Ds') a = allowed.double ? 'D' : 'S';
  // surrender never applies to a split pair of eights
  if (a === 'R' && isPair(cards) && cardValue(cards[0]) === 8) a = allowed.split ? 'P' : 'H';
  return { H: 'hit', S: 'stand', D: 'double', P: 'split', R: 'surrender' }[a];
}

// Rough chance the dealer busts, by upcard (6 decks, stands on soft 17).
export const DEALER_BUST = { 2: 35, 3: 37, 4: 40, 5: 42, 6: 42, 7: 26, 8: 24, 9: 23, 10: 21, 11: 17 };

export const upName = up => (up === 11 ? 'ace' : up === 10 ? '10' : String(up));

// Plain-language reason for the basic-strategy play.
export function reasonFor(action, cards, up, allowed) {
  const v = handValue(cards);
  const bust = DEALER_BUST[up];
  const weak = up >= 2 && up <= 6;
  const U = upName(up);
  const pair = isPair(cards) ? cardValue(cards[0]) : 0;
  switch (action) {
    case 'split':
      if (pair === 11) return `Always split aces: each ace starts a new hand worth 11, a great start.`;
      if (pair === 8) return `Always split eights: 16 is the worst total in blackjack, but each 8 starts a decent hand.`;
      if (pair === 9) return `Split nines: two hands starting on 9 do better against a ${U} than one 18.`;
      return `Split: against a ${weak ? `weak upcard like ${U} (dealer busts about ${bust}% of the time)` : U}, two hands starting on ${pair} make more money than playing ${pair * 2}.`;
    case 'double':
      if (v.soft) return `Double on soft ${v.total}: the dealer's ${U} is weak (busts about ${bust}% of the time) and your ace means one more card can't bust you.`;
      if (v.total === 11) return `Double on 11: any 10-value card (nearly a third of the deck) gives you 21.`;
      return `Double on ${v.total}: you're likely to end with a good total while the dealer's ${U} is ${weak ? `weak (busts about ${bust}% of the time)` : 'beatable'}. Doubling doubles your bet for exactly one more card.`;
    case 'surrender':
      return `Surrender: ${v.total} against a ${U} loses so often that giving up half your bet now saves money in the long run.`;
    case 'stand':
      if (v.total >= 17 && !v.soft) return `Stand on ${v.total}: the chance of busting if you hit is too high.`;
      if (v.soft && v.total >= 18) return `Stand on soft ${v.total}: it's a good total and the dealer's ${U} isn't strong enough to chase.`;
      if (weak) return `Stand on ${v.total}: the dealer's ${U} is a weak upcard and busts about ${bust}% of the time, so don't risk busting yourself — let the dealer take the risk.`;
      return `Stand on ${v.total}.`;
    case 'hit':
      if (v.soft) return `Hit soft ${v.total}: the ace can count as 1, so you can't bust with one card${allowed && !allowed.double && chartAction(cards, up).startsWith('D') ? ' (you would double, but you can only double on your first two cards)' : ''}.`;
      if (v.total <= 11) return `Hit: with ${v.total} you can't bust, so always take a card.`;
      if (up >= 7) return `Hit ${v.total}: against a strong upcard like ${U} the dealer will usually make 17 or more, so ${v.total} isn't enough. You need to improve.`;
      return `Hit ${v.total}: even against a ${U}, standing on ${v.total} loses more often than taking a card.`;
  }
  return '';
}

export function dealerRuleText(cards) {
  const v = handValue(cards);
  if (v.total > 21) return 'busts';
  if (v.total >= 17) return v.soft ? `stands on soft ${v.total} (the dealer must stand on all 17s)` : `stands on ${v.total}`;
  return `has ${v.soft ? 'soft ' : ''}${v.total}, so must hit (the dealer draws on 16 or less)`;
}
