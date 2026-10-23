-- Add BigCommerce and Wix to the shared Connected stores provider layer.
-- Credentials remain encrypted in cms_connections.credentials_encrypted.

ALTER TABLE cms_connections
  DROP CONSTRAINT IF EXISTS cms_connections_platform_check;

ALTER TABLE cms_connections
  ADD CONSTRAINT cms_connections_platform_check
  CHECK (platform IN ('shopify', 'woocommerce', 'bigcommerce', 'wix'));
