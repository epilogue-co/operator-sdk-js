#include "fake_device.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

int backup(opsdk_t *dev, int (*persist)(const uint8_t *, size_t, void *), void *user);

#ifdef NDEBUG
#error The evaluation requires assertions
#endif

enum scenario { NORMAL, REMOVED, DAMAGED };

struct storage {
  size_t size;
  int result;
  unsigned calls;
};

static int persist(const uint8_t *bytes, size_t length, void *user) {
  struct storage *storage = user;
  ++storage->calls;
  assert(length == storage->size);
  assert(memcmp(bytes, fake_save, length) == 0);
  return storage->result;
}

static void pull_during_checksum(const opsdk_trace_t *event, void *user) {
  if (event->kind == OPSDK_TRACE_RECEIVE && event->op == OPSDK_OP_SAVE_CRC32)
    fake_set_platform(user, OPSDK_PLATFORM_EMPTY);
}

static int damage_save_read(void *fake, uint8_t *buf, size_t length, uint32_t timeout_ms) {
  int count = fake_transport()->read(fake, buf, length, timeout_ms);
  if (count >= 8 && memcmp(buf, fake_save, 8) == 0) buf[0] ^= 1;
  return count;
}

static void run_case(const char *name, fake_options_t options, int storage_result, enum scenario scenario,
                     int expected, unsigned expected_calls) {
  struct storage storage = {options.save_size, storage_result, 0};
  fake_device_t *fake = fake_create(&options);
  opsdk_t *dev = NULL;
  opsdk_transport_t transport = *fake_transport();
  if (scenario == DAMAGED) transport.read = damage_save_read;
  assert(opsdk_open_transport(&dev, &transport, fake) == OPSDK_OK);
  if (options.save_size == 1) {
    opsdk_cart_t cart;
    assert(opsdk_cart_status(dev, &cart) == OPSDK_OK && cart.logo_valid && cart.save_size == 0);
  }
  if (scenario == REMOVED) opsdk_set_trace(dev, pull_during_checksum, fake);
  int result = backup(dev, persist, &storage);
  if (scenario == NORMAL) assert(result == expected);
  else assert(result != OPSDK_OK);
  assert(storage.calls == expected_calls);
  if (storage.calls) {
    if (storage.size % 512 == 0) assert(fake_count(fake, OPSDK_OP_SAVE_CRC32) > 0);
    else assert(fake_count(fake, OPSDK_OP_SAVE_READ) >= 2);
  }
  assert(fake_count(fake, OPSDK_OP_SAVE_WRITE) == 0);
  assert(opsdk_ping(dev, 42) == OPSDK_OK);
  assert(opsdk_session_end(dev) == OPSDK_NO_SESSION);
  opsdk_close(dev);
  fake_destroy(fake);
  puts(name);
}

int main(void) {
  fake_init_data();
  fake_options_t cart = {.sdk = true, .platform = OPSDK_PLATFORM_GB, .save_size = 8192};
  run_case("stores a verified whole-block save", cart, OPSDK_OK, NORMAL, OPSDK_OK, 1);
  run_case("returns the storage error", cart, OPSDK_E_IO, NORMAL, OPSDK_E_IO, 1);
  run_case("detects removal during checksum", cart, OPSDK_OK, REMOVED, OPSDK_OK, 0);
  run_case("rejects bytes that disagree with the cartridge checksum", cart, OPSDK_OK, DAMAGED, OPSDK_OK, 0);
  cart.save_size = 128;
  run_case("verifies a small save with a second read", cart, OPSDK_OK, NORMAL, OPSDK_OK, 1);
  cart.platform = OPSDK_PLATFORM_EMPTY;
  run_case("rejects an unreadable cartridge", cart, OPSDK_OK, NORMAL, OPSDK_NO_CARTRIDGE, 0);
  cart.platform = OPSDK_PLATFORM_GB;
  cart.status_fails = true;
  run_case("propagates device status failure", cart, OPSDK_OK, NORMAL, OPSDK_ABORTED, 0);
  cart.status_fails = false;
  cart.save_size = 1;
  run_case("rejects a readable cartridge with no save", cart, OPSDK_OK, NORMAL, OPSDK_E_ARGUMENT, 0);
  return 0;
}
