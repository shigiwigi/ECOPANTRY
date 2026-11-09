#include "live_session.h"

namespace ecopantry {

const char* sessionStateName(SessionState state) {
  switch (state) {
    case SessionState::Starting: return "starting";
    case SessionState::Live: return "live";
    case SessionState::Paused: return "paused";
    case SessionState::Locked: return "locked";
  }
  return "?";
}

void LiveSession::onStatus(bool live, uint32_t remainingSeconds, bool budgetExhausted, uint32_t nowMs) {
  if (state_ == SessionState::Locked) return;
  budgetExhausted_ = budgetExhausted;
  bootAttempts_ = 0;
  if (!live || remainingSeconds == 0) {
    state_ = SessionState::Paused;
    durationMs_ = 0;
    return;
  }
  uint64_t duration = static_cast<uint64_t>(remainingSeconds) * 1000u;
  if (duration > maxSessionMs_) duration = maxSessionMs_;
  state_ = SessionState::Live;
  startedMs_ = nowMs;
  durationMs_ = static_cast<uint32_t>(duration);
}

void LiveSession::onNotLive() {
  if (state_ == SessionState::Locked) return;
  state_ = SessionState::Paused;
  durationMs_ = 0;
}

void LiveSession::onUnauthorized() {
  state_ = SessionState::Locked;
  durationMs_ = 0;
}

void LiveSession::onTokenSaved() {
  if (state_ != SessionState::Locked) return;
  state_ = SessionState::Starting;
  bootAttempts_ = 0;
  budgetExhausted_ = false;
}

void LiveSession::onBootAttemptFailed() {
  if (state_ != SessionState::Starting) return;
  if (++bootAttempts_ >= maxBootAttempts_) state_ = SessionState::Paused;
}

void LiveSession::restart() {
  if (state_ == SessionState::Locked) return;
  state_ = SessionState::Starting;
  bootAttempts_ = 0;
}

void LiveSession::tick(uint32_t nowMs) {
  if (state_ == SessionState::Live && remainingMs(nowMs) == 0) {
    state_ = SessionState::Paused;
    durationMs_ = 0;
  }
}

uint32_t LiveSession::remainingMs(uint32_t nowMs) const {
  if (state_ != SessionState::Live) return 0;
  const uint32_t elapsed = nowMs - startedMs_;  // unsigned maths survives millis() wrapping
  return elapsed >= durationMs_ ? 0 : durationMs_ - elapsed;
}

uint32_t Backoff::next() {
  const uint32_t current = nextMs_;
  nextMs_ = nextMs_ >= maxMs_ / 2 ? maxMs_ : nextMs_ * 2;
  return current;
}

}  // namespace ecopantry
