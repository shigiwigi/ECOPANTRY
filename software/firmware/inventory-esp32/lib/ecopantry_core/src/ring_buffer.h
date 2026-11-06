// Fixed-size FIFO that overwrites the oldest item when full. No heap, no locking:
// the network task guards it with a mutex.
#pragma once

#include <cstddef>

namespace ecopantry {

template <typename T, size_t Capacity>
class RingBuffer {
  static_assert(Capacity > 0, "RingBuffer needs room for at least one item");

 public:
  // Returns true if the oldest item had to be dropped to make room.
  bool push(const T& item) {
    const bool full = count_ == Capacity;
    items_[(head_ + count_) % Capacity] = item;
    if (full) {
      head_ = (head_ + 1) % Capacity;
    } else {
      ++count_;
    }
    return full;
  }

  // Copies up to `max` of the oldest items into `out`, without removing them.
  size_t peekOldest(T* out, size_t max) const {
    const size_t n = max < count_ ? max : count_;
    for (size_t i = 0; i < n; ++i) out[i] = items_[(head_ + i) % Capacity];
    return n;
  }

  void dropOldest(size_t n) {
    if (n > count_) n = count_;
    head_ = (head_ + n) % Capacity;
    count_ -= n;
  }

  void clear() { head_ = count_ = 0; }
  size_t size() const { return count_; }
  bool empty() const { return count_ == 0; }
  static constexpr size_t capacity() { return Capacity; }

 private:
  T items_[Capacity] = {};
  size_t head_ = 0;
  size_t count_ = 0;
};

}  // namespace ecopantry
