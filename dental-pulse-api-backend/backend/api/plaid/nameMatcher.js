// Port of dentledger NameMatcher.php — string similarity 0–100
// Uses the same similar_text algorithm as PHP's similar_text()

const COMPANY_SUFFIXES = [
  'ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'corp', 'corporation',
  'co', 'group', 'holdings', 'dental', 'practice', 'centre', 'center',
];

function normalize(name) {
  if (!name) return '';
  const suffixPattern = new RegExp(
    `\\b(${COMPANY_SUFFIXES.join('|')})\\b`,
    'gi'
  );
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(suffixPattern, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Recursive similar_text (mirrors PHP implementation)
function similarText(first, second) {
  if (!first.length || !second.length) return 0;

  let longest = 0;
  let longestI = 0;
  let longestJ = 0;

  for (let i = 0; i < first.length; i++) {
    for (let j = 0; j < second.length; j++) {
      let l = 0;
      while (
        i + l < first.length &&
        j + l < second.length &&
        first[i + l] === second[j + l]
      ) {
        l++;
      }
      if (l > longest) {
        longest = l;
        longestI = i;
        longestJ = j;
      }
    }
  }

  let sum = longest;
  if (longest) {
    if (longestI && longestJ) {
      sum += similarText(first.substring(0, longestI), second.substring(0, longestJ));
    }
    if (longestI + longest < first.length && longestJ + longest < second.length) {
      sum += similarText(
        first.substring(longestI + longest),
        second.substring(longestJ + longest)
      );
    }
  }
  return sum;
}

function computeScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const common = similarText(a, b);
  return Math.round((common * 2 / (a.length + b.length)) * 100);
}

/**
 * Score how well bankHolderName matches the business.
 * Compares against both legal name and trading name, returns the max.
 * Returns 0–100.
 */
function score(legalName, bankHolderName, tradingName = null) {
  const b = normalize(bankHolderName);
  if (!b) return 0;

  const a1 = normalize(legalName);
  let best = a1 ? computeScore(a1, b) : 0;

  if (tradingName) {
    const a2 = normalize(tradingName);
    if (a2) best = Math.max(best, computeScore(a2, b));
  }

  return best;
}

module.exports = { score, normalize };
