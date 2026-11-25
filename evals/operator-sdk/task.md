Implement three ES module exports for an app using the Epilogue Operator JavaScript SDK.
It passes in an already connected Operator. Leave that connection open for the caller.

- `identify(op)`: return the readable cartridge signature, or null if no header reads.
- `backup(op, persist)`: verify the current save and await persist(bytes) once to store it.
  Reject if the cartridge has no save.
- `restore(op, replacement, persist, confirm, signal)`: restore an entire save (a positive
  multiple of 512 bytes). Save a verified recovery copy with persist(bytes) and obtain
  confirmation with await confirm() before overwriting. Return true for a verified write
  or false when confirmation is declined. Respect the AbortSignal while waiting to write.

Handle cartridge removal and device failures. Propagate errors to the caller. Use the
supplied SDK docs. Return only the complete JavaScript module, with no Markdown fence.
