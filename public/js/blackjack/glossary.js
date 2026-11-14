// Blackjack words. Coach text marks them {{term}} or {{term|shown text}}.

export const BJ_GLOSSARY = {
  'blackjack': 'An ace plus a 10-value card (10, jack, queen or king) as your first two cards — 21 in two cards. It pays 3 to 2 and beats any other 21. Also called a natural.',
  'natural': 'Another name for a blackjack: 21 with your first two cards.',
  'hit': 'Take another card. Signal it by tapping the table.',
  'stand': 'Take no more cards and keep your total. Signal it by waving your hand flat over your cards.',
  'double down': 'Double your bet in exchange for exactly one more card. Only allowed on your first two cards (and on the first two cards of a split hand here).',
  'split': 'When your first two cards have the same value, put out a second equal bet and play them as two separate hands. Split aces get just one card each.',
  'surrender': 'Give up your hand after the first two cards and get half your bet back. Not every table offers it.',
  'insurance': 'When the dealer shows an ace you may bet up to half your stake that the dealer has blackjack. It pays 2 to 1 but loses money in the long run, so basic strategy never takes it.',
  'even money': 'Offered when you have blackjack and the dealer shows an ace: take a 1-to-1 payout now instead of risking a push. It\'s the same bet as insurance, and basic strategy says no.',
  'bust': 'Going over 21. You lose straight away, even if the dealer busts later.',
  'push': 'A tie with the dealer. Your bet is returned; nobody wins.',
  'soft hand': 'A hand with an ace counted as 11, like A-6 = soft 17. It can\'t bust with one more card because the ace can drop to 1.',
  'hard hand': 'A hand with no ace, or with every ace counted as 1, like 10-6 = hard 16. One more card can bust it.',
  'upcard': 'The dealer\'s face-up card. Almost every decision depends on it.',
  'hole card': 'The dealer\'s face-down card. It\'s turned over after all the players have finished.',
  'peek': 'When the dealer\'s upcard is an ace or a 10, the dealer checks the hole card for blackjack before anyone plays, so you never lose extra bets to a dealer blackjack.',
  'shoe': 'The box holding several decks shuffled together. This table uses six decks.',
  'cut card': 'A plastic card placed about three-quarters of the way into the shoe. When it comes out, the cards are shuffled after that round.',
  'burn card': 'The first card out of a freshly shuffled shoe goes straight into the discard tray, unseen.',
  'discard tray': 'Where used cards go until the shoe is shuffled.',
  'penetration': 'How far into the shoe the dealer goes before shuffling — here about 75%.',
  'basic strategy': 'The mathematically best play for every hand against every dealer upcard. Following it cuts the house edge to about half a percent.',
  'house edge': 'The casino\'s long-run advantage, as a percentage of what you bet. With perfect basic strategy at this table it\'s about 0.5%.',
  'first base': 'The seat on the dealer\'s left, which plays first.',
  'third base': 'The seat on the dealer\'s right, which plays last, just before the dealer.',
  'dealer stands on soft 17': 'House rule: the dealer must keep drawing on 16 or less and must stand on any 17, including soft 17. Better for players than "dealer hits soft 17".',
  'stiff': 'A hard 12 to 16: a hand that can bust if you hit but probably loses if you stand.',
  'bust card': 'A dealer upcard of 2 to 6, which leaves the dealer likely to bust.',
  'table minimum': 'The smallest bet allowed at the table (here 10). There\'s a maximum too (here 500).',
  'chips': 'Casino money. White 1, red 5, green 25, black 100, purple 500.',
  'colour up': 'Swap small chips for bigger ones when you leave the table.',
  'card counting': 'Keeping track of which cards have gone to know when the remaining cards favour the player. Legal, but casinos may ask counters to leave.',
  'pays 3 to 2': 'A blackjack wins one and a half times your bet: a 10 bet wins 15.',
};

export function lookupBJ(term) {
  const t = term.toLowerCase().trim();
  return BJ_GLOSSARY[t] ? { term: t, def: BJ_GLOSSARY[t] } : null;
}
export function searchBJGlossary(q) {
  const s = q.toLowerCase().trim();
  const keys = Object.keys(BJ_GLOSSARY).sort();
  return keys.filter(k => !s || k.includes(s) || BJ_GLOSSARY[k].toLowerCase().includes(s)).map(k => ({ term: k, def: BJ_GLOSSARY[k] }));
}
