---
name: operator-sdk
description: Build or review C and JavaScript apps that use Epilogue GB Operator or SN Operator to identify a cartridge, read games, read or write saves, or use the RTC and cartridge peripherals.
---

Use the API reference for the installed version: [JavaScript](https://www.epilogue.co/developers/sdk/javascript) and [C](https://www.epilogue.co/developers/sdk/c). The JavaScript package includes TypeScript declarations in `dist/`. Import browser APIs from `@epilogue/opsdk` and Node serial APIs from `@epilogue/opsdk/node`. In C, include `opsdk.h` and check each status before using its output. The [JavaScript SDK](https://github.com/epilogue-co/operator-sdk-js) and [C SDK](https://github.com/epilogue-co/operator-sdk-c) have runnable examples.

**Identify.** Check `logoValid` or `logo_valid` on the cartridge status. A platform can be present with an unreadable header. Propagate I/O failures.

**Read a save.** A reported save size of zero means there is no save to back up. Otherwise, read exactly the reported size. Compare the CRC-32 of the bytes with `saveCrc32(cart)` or `opsdk_save_crc32(dev, &cart, 0, cart.save_size, &crc)`. For a whole save whose size is not divisible by 512, the helper verifies by reading again. Recheck that the header is readable and the signature matches before storing the bytes.

**Write a save.** For a whole-save restore, follow this order.

1. Check that the replacement matches the reported size. The restore walkthrough supports positive multiples of 512 and excludes cartridges flagged as flashcart or counterfeit.
2. Verify and persist the original save. Ask for confirmation only after storage succeeds.
3. Open a session and check for cancellation. Check the returned cartridge, then read its save and compare it with the recovery copy. Two copies of the same game can share a signature.
4. Recheck the readable header and signature, then check cancellation immediately before the write. In C, a signal handler sets a flag that the calling code checks between SDK calls.
5. Write once with the session's cartridge and let the operation finish. Read back the replacement, compare the bytes, and check the readable header and signature before reporting success. Keep the recovery copy on failure.

End a session you opened on every exit. Preserve the first error if cleanup also fails. Report a cleanup error if it is the only failure. Leave a caller-owned connection open.

Test with `test/fake-operator.mjs` in the JavaScript checkout or `tests/fake_device.c` in the C checkout.
