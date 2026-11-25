# Epilogue Operator SDK

An optional coding skill for apps that use the C or JavaScript Operator SDK.
It helps the agent use the installed SDK, verify backups and handle interrupted restores.

From the root of this checkout, install it in the client you use.

**Codex**

```sh
codex plugin marketplace add .
codex plugin add operator-sdk@epilogue
```

**Claude Code**

```sh
claude plugin marketplace add .
claude plugin install operator-sdk@epilogue
```

Start a new session in your app and ask, for example, "Add a verified save backup
to this project using the Epilogue Operator SDK." The app uses the normal
[JavaScript](https://github.com/epilogue-co/operator-sdk-js) or
[C](https://github.com/epilogue-co/operator-sdk-c) library.
