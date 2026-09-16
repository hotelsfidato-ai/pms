# Claims do not live here any more

**Since 16 September a claim is made with a command**, from your copy's folder:

```powershell
npm run claims                          # who holds what, right now
npm run claim -- pos "what you are doing"
npm run release -- pos                  # when you stop
```

They are kept in the git folder every working copy shares
(`git rev-parse --git-common-dir`, under `fidato-claims/`), because a file in
this folder is visible only in the copy that wrote it. On 16 September twelve
chats were working in twelve copies and this folder, in the master's copy,
showed none of them. Root `MEMORY.md` 281.

**Do not write claim files here, and never commit one.**
