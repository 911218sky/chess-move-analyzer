namespace SharedDisplay {
  export function normalizePredictionSide(value?: string | null): PredictionSide {
    return value === "white" || value === "black" ? value : "both";
  }
}
