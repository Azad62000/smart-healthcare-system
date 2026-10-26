type DoctorRatingProps = { average?: number | null; count?: number };

function formatReviewCount(count: number): string {
  if (count < 1000) return new Intl.NumberFormat("en").format(count);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count).toLowerCase();
}

export function DoctorRating({ average, count = 0 }: DoctorRatingProps) {
  if (count < 1 || average === null || average === undefined) {
    return <p className="doctor-rating-empty"><span className="doctor-rating-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index}>★</span>)}</span><span>No patient ratings yet</span></p>;
  }
  const stars = Math.max(0, Math.min(5, Math.round(average)));
  return <p className="doctor-rating" aria-label={`${average.toFixed(1)} out of 5 stars from ${count} patient ${count === 1 ? "review" : "reviews"}`}>
    <span className="doctor-rating-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className={index < stars ? "is-filled" : ""} key={index}>★</span>)}</span>
    <strong>{average.toFixed(1)}</strong>
    <span className="doctor-rating-count">{formatReviewCount(count)} {count === 1 ? "review" : "reviews"}</span>
  </p>;
}
