// Average of the last N samples, for smoothing single HX711 reads without blocking.
#pragma once

#include <cstddef>

namespace ecopantry {

template <size_t N>
class MovingAverage {
  static_assert(N > 0, "MovingAverage needs at least one sample");

 public:
  void add(float sample) {
    if (count_ == N) sum_ -= samples_[next_];
    samples_[next_] = sample;
    sum_ += sample;
    next_ = (next_ + 1) % N;
    if (count_ < N) ++count_;
  }

  float value() const { return count_ == 0 ? 0.0f : static_cast<float>(sum_ / count_); }
  size_t size() const { return count_; }
  bool full() const { return count_ == N; }
  void reset() { count_ = next_ = 0; sum_ = 0; }

 private:
  float samples_[N] = {};
  double sum_ = 0;
  size_t next_ = 0;
  size_t count_ = 0;
};

}  // namespace ecopantry
