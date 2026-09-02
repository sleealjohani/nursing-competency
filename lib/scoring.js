'use strict';

/**
 * Scoring rules transcribed from the competency forms:
 *
 *   Raw Score   = number of items rated Met
 *   Total Score = number of items, minus the ones rated NA
 *                 ("NA entries to be deducted from the total score")
 *   % Rating    = Raw / Total x 100
 *   Met         = 90% - 100%   |   Not Met = 89% and below (remedial once)
 */
const PASS_MARK = 90;

const RATINGS = {
  competency: ['M', 'NM', 'NA'],
  // The equipment checklist uses its own scale. UEC ("uses the equipment
  // independently") is the level treated as competent; VT and RD are stages on
  // the way there and score 0, matching how M / NM behave on the other forms.
  equipment: ['VT', 'RD', 'UEC', 'NA'],
};

const MET_RATING = { competency: 'M', equipment: 'UEC' };
const NA_RATING = 'NA';

function ratingsFor(formType) {
  return RATINGS[formType] || RATINGS.competency;
}

function isValidRating(formType, rating) {
  return ratingsFor(formType).includes(rating);
}

/** Every item id on a form, in display order: "<sectionIndex>.<itemNo>". */
function itemKeys(form) {
  const keys = [];
  form.sections.forEach((section, index) => {
    section.items.forEach((item) => keys.push(`${index}.${item.no}`));
  });
  return keys;
}

/**
 * @param {object} form     a form from data/competencies.json
 * @param {object} answers  { "<sectionIndex>.<itemNo>": rating }
 */
function score(form, answers) {
  const formType = form.form_type || 'competency';
  const met = MET_RATING[formType];
  const keys = itemKeys(form);

  let rawScore = 0;
  let naCount = 0;
  let answered = 0;

  for (const key of keys) {
    const rating = answers[key];
    if (!rating) continue;
    answered += 1;
    if (rating === NA_RATING) naCount += 1;
    else if (rating === met) rawScore += 1;
  }

  const totalScore = keys.length - naCount;
  // A form answered entirely NA has nothing to score against; the hospital
  // reads that as not applicable rather than as a failure.
  const percent = totalScore > 0
    ? Math.round((rawScore / totalScore) * 1000) / 10
    : null;

  return {
    rawScore,
    totalScore,
    naCount,
    itemCount: keys.length,
    answered,
    unanswered: keys.length - answered,
    complete: answered === keys.length,
    percent,
    result: percent === null ? 'NA' : (percent >= PASS_MARK ? 'Met' : 'Not Met'),
    needsRemedial: percent !== null && percent < PASS_MARK,
  };
}

module.exports = {
  PASS_MARK, RATINGS, MET_RATING, NA_RATING,
  ratingsFor, isValidRating, itemKeys, score,
};
