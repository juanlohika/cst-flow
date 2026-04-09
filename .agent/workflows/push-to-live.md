---
description: How to push changes to GitHub and trigger live deployment
---

After completing any task, fixing a bug, or implementing a feature, you MUST push the changes to GitHub to trigger the Firebase App Hosting deployment.

1. Ensure the build passes locally:
   `npm run build`

2. Commit all changes:
   `git add .`
   `git commit -m "feat: [description of changes]"`

3. Push to the main branch:
   `git push origin main`

4. Verify that the build triggered in Firebase.
