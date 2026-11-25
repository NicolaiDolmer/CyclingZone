/** @param {unknown} error */
export function isMissingBoardComebackColumn(error) {
  return error != null && typeof error === "object"
    && "code" in error && (error.code === "42703" || error.code === "PGRST204")
    && "message" in error && typeof error.message === "string"
    && /\bcomeback_board_season_number\b/.test(error.message);
}
