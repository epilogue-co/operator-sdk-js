# Evaluate the Operator SDK skill

Give the agent [the app task](task.md) in a fresh project. Supply the JavaScript
API reference, Get started, Read save and Write save pages from the same docs
revision in each run. Compare the same model with and without the skill. Keep
the generated modules separate. The grader belongs to the evaluator's checkout.

Save a generated module as `.test-output/candidate.mjs` under this repository.
Review its imports before running it. The harness provides an Operator connected
to the SDK's in-memory fake.

```sh
npm ci
npm run build
OPSDK_CANDIDATE=.test-output/candidate.mjs node evals/operator-sdk/grade.mjs
```

The JavaScript checks cover cartridge identification, backups and restore. They
simulate a damaged recovery copy, cancellation or a swap before writing, corrupt
readback and session cleanup failures.

For C, give the agent [the backup task](task-c.md) and the public API from the
same version of `opsdk.h` in each run. Review the generated source and save it
as `.test-output/candidate.c`. From this repository on macOS or Linux, set
`OPSDK_C_ROOT` to the C SDK checkout and run:

```sh
OPSDK_C_BUILD="$PWD/.test-output/c-build"
cmake -S "$OPSDK_C_ROOT" -B "$OPSDK_C_BUILD" -DBUILD_SHARED_LIBS=OFF -DOPSDK_BUILD_TESTS=ON
cmake --build "$OPSDK_C_BUILD" --target opsdk_fake_device
cc -std=c99 -Wall -Wextra -Werror -I"$OPSDK_C_ROOT/include" -I"$OPSDK_C_ROOT/tests" \
  evals/operator-sdk/grade-backup.c .test-output/candidate.c \
  "$OPSDK_C_BUILD/tests/libopsdk_fake_device.a" "$OPSDK_C_BUILD/libopsdk.a" -lm \
  -o .test-output/grade-backup
.test-output/grade-backup
```

The C grader checks backup bytes and storage calls, error propagation, cartridge
removal, damaged reads, small saves, and a cartridge with no save memory.
