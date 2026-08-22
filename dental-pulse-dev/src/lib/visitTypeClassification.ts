export type VisitType = 'exam' | 'hygiene' | 'xray' | 'other';

// Dentally's treatment_categories are synced live per-org with no fixed
// names, so there's no structured "this is an exam" flag anywhere — this is
// a best-effort keyword match against the category/treatment name, same
// spirit as useAppointmentForecast.ts's CLINICAL_KEYWORDS/NEITHER_KEYWORDS
// bucketing but a dedicated exam/hygiene/xray keyword set (that file's
// buckets are lab/clinical/neither, a different taxonomy).
const HYGIENE_KEYWORDS = ['hygien', 'scale', 'polish', 'perio maintenance', 'periodontal maintenance'];
const XRAY_KEYWORDS = ['x-ray', 'x ray', 'xray', 'radiograph', 'opg', 'bitewing', 'panoramic'];
const EXAM_KEYWORDS = ['exam', 'assessment', 'check up', 'check-up', 'checkup', 'recall'];

/** Hygiene checked before xray before exam: "Hygienist Exam"/"Hygiene
 *  Assessment" style names should count as the hygiene visit, not the exam;
 *  x-ray keywords are narrow enough to check ahead of exam's broad
 *  "recall"/"assessment" keywords so a combined name like "Recall exam and
 *  bitewing" counts as the x-ray, not the exam. */
export function classifyVisitType(
  categoryName: string | null | undefined,
  treatmentName: string | null | undefined,
): VisitType {
  const text = `${categoryName ?? ''} ${treatmentName ?? ''}`.toLowerCase();
  if (HYGIENE_KEYWORDS.some((k) => text.includes(k))) return 'hygiene';
  if (XRAY_KEYWORDS.some((k) => text.includes(k))) return 'xray';
  if (EXAM_KEYWORDS.some((k) => text.includes(k))) return 'exam';
  return 'other';
}
