// When the station may upload.
//
//   Starting --(server says live)--> Live --(timer runs out / 409)--> Paused
//   Starting --(5 failed tries / not live)--> Paused
//   Paused   --(granted card tap / boot session again)--> Live
//   any      --(401: token revoked or device disabled)--> Locked
//   Locked   --(token saved on the setup page / reboot)--> Starting
//
// A 401 also opens the setup hotspot (wifi_setup.h) so a new token can be entered there.
// While Paused or Locked the station makes no upload requests at all, so the backend
// and the database can sleep. Only a card tap (or a reboot) talks to the server again.
// The server owns the session length; the station also enforces kMaxSessionMs locally
// in case it never got a usable answer.
#pragma once

#include <cstdint>

namespace ecopantry {

enum class SessionState : uint8_t { Starting, Live, Paused, Locked };

const char* sessionStateName(SessionState state);

class LiveSession {
 public:
  explicit LiveSession(uint32_t maxSessionMs, uint8_t maxBootAttempts = 5)
      : maxSessionMs_(maxSessionMs), maxBootAttempts_(maxBootAttempts) {}

  SessionState state() const { return state_; }
  bool mayUpload() const { return state_ == SessionState::Live; }
  bool wantsBootSession() const { return state_ == SessionState::Starting; }
  bool budgetExhausted() const { return budgetExhausted_; }

  // Any 2xx answer from the server carries the live status.
  void onStatus(bool live, uint32_t remainingSeconds, bool budgetExhausted, uint32_t nowMs);
  // 409 session_not_live: stop uploading now.
  void onNotLive();
  // 401: the token was revoked or the device disabled. Stays locked until a token is saved
  // on the setup page (onTokenSaved) or the station reboots.
  void onUnauthorized();
  // Settings were saved on the setup page: unlock and ask for a boot session again.
  void onTokenSaved();
  // The boot-session request failed (network or 5xx). Gives up after a few tries.
  void onBootAttemptFailed();
  // Ask for a boot session again (serial `session` command). Ignored while Locked.
  void restart();

  // Ends the session when its time is up. Call often.
  void tick(uint32_t nowMs);
  uint32_t remainingMs(uint32_t nowMs) const;

 private:
  uint32_t maxSessionMs_;
  uint8_t maxBootAttempts_;
  uint8_t bootAttempts_ = 0;
  SessionState state_ = SessionState::Starting;
  bool budgetExhausted_ = false;
  uint32_t startedMs_ = 0;
  uint32_t durationMs_ = 0;
};

// Exponential backoff for failed requests: min, 2*min, 4*min ... capped at max.
class Backoff {
 public:
  Backoff(uint32_t minMs, uint32_t maxMs) : minMs_(minMs), maxMs_(maxMs), nextMs_(minMs) {}
  uint32_t next();
  void reset() { nextMs_ = minMs_; }

 private:
  uint32_t minMs_, maxMs_, nextMs_;
};

}  // namespace ecopantry
