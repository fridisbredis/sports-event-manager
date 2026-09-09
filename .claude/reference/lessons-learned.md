# Lessons learned (from real debugging sessions)

> Read this when debugging something that smells like it might be a repeat of a known issue. Not loaded into every session by default — see the pointer in the core `CLAUDE.md`.

---

## Phase 4: The `wvw` vs `wvv` typo (cost ~2 days of debugging)

A Supabase URL was typed with `wvv` instead of `wvw` and the typo propagated through 1Password, GitHub Secrets, and several debug attempts. Browser bundle inspection (DevTools → loaded JS → search for the value) is the source of truth for what got built into the deploy. When updating a secret seems to not take effect, hardcode the value in workflow.yml temporarily — that eliminates the secret as a variable.

URLs with repeated character patterns (`wvw`) are very easy to mistype as a single letter (`wvv`). Always copy from the source UI's Copy button.

## Phase 5: Probe of StartUp failed with status code: 1 (cost ~1 hour)

Prod Container App was created with `minReplicas: null` (effectively 0). When the Next.js app started successfully but Azure's HTTP startup probe failed a few times during cold start, KEDA scaled it to zero and Azure fell back to the hello-world placeholder revision. The fix was to set `minReplicas: 1` — keeps a pod always warm and gives the probe more retries.

"ManuallyStopped" in `ContainerAppSystemLogs_CL` does NOT mean a manual stop — it's KEDA deactivating the deployment. Don't be misled by the terminology.

Dev had `minReplicas: 1` from earlier setup, which is why dev worked and prod didn't with otherwise identical configs.

## Phase 5: Port mismatch from hello-world placeholder (cost ~30 min)

Container App was created with `--target-port 80` (from the hello-world image default). Next.js listens on 3000. Required `az containerapp ingress update --target-port 3000` after the fact. **Future:** when creating Container Apps from scratch, set the target port directly.

## Phase 5: ACR auth missing on Container App (cost ~15 min)

Container App couldn't pull from ACR despite the service principal having AcrPush. The Container App resource itself needs registry credentials configured via `az containerapp registry set` — this is a one-time config, separate from GitHub Actions' ACR access.

## Phase 5: Two similar GitHub Secrets caused confusion

`DEV_SUPABASE_URL` and `DEV_APP_URL` are different things (Supabase API vs the deployed app's own URL). At one point in debugging it was unclear which contained what, contributing to the wvw/wvv confusion. Naming conventions matter — `*_SUPABASE_URL` for the database, `*_APP_URL` for the Azure-hosted app URL.
