Implement a C99 function for an app that already has an open Epilogue Operator.

```c
#include <opsdk.h>
int backup(opsdk_t *dev, int (*persist)(const uint8_t *, size_t, void *), void *user);
```

Back up the entire save, including small saves. Call persist once with verified
bytes while its buffer is valid. Return OPSDK_OK on success, OPSDK_NO_CARTRIDGE
for an unreadable header, OPSDK_E_ARGUMENT if the cartridge reports no save,
or the error from the SDK or storage callback. Detect
a cartridge change during verification. Leave the caller's connection open.
Return only the C source.
