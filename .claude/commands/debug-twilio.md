Context:
@context.md
@skills/auth-flow.md

Task:
Debug a Twilio SMS / OTP delivery issue.

Code:
{{selection}}

Error:
{{error}}

Twilio setup:
- Subaccount: sports-event-manager (SID in 1Password)
- Dev Messaging Service: has Swedish number +46728101619 assigned
- Prod Messaging Service: has Swedish number +46766900096 assigned
- Credentials in GitHub Secrets: DEV_TWILIO_ACCOUNT_SID, DEV_TWILIO_AUTH_TOKEN, DEV_TWILIO_PHONE_NUMBER, PROD_TWILIO_ACCOUNT_SID, PROD_TWILIO_AUTH_TOKEN, PROD_TWILIO_PHONE_NUMBER

Checklist:
- SMS not delivered → check Twilio Console logs for the subaccount (not main account)
- Wrong sender → verify DEV_TWILIO_PHONE_NUMBER secret matches +46728101619
- Prod SMS not delivered → check Twilio Console logs for the subaccount; verify PROD_TWILIO_PHONE_NUMBER secret matches +46766900096
- OTP delivered but Supabase rejects it → Twilio sent it fine; issue is in verifyOtp() (see fix-auth.md)
- Secrets not taking effect → hardcode value in workflow.yml temporarily to isolate
- "Authentication Error" from Twilio → SID/token mismatch, check secrets match the subaccount (not main account)

Output:
- Root cause (Twilio side vs Supabase side)
- Fix
