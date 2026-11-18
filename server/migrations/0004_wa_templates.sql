-- WhatsApp Cloud API approved templates (needed for messages to people who did not write in the last 24 h)
ALTER TABLE templates ADD COLUMN wa_template TEXT;   -- approved template name in Meta WhatsApp Manager
ALTER TABLE templates ADD COLUMN wa_lang TEXT;       -- e.g. en, en_US, hi
ALTER TABLE templates ADD COLUMN wa_params TEXT;     -- portal variables for {{1}}, {{2}}… in order, e.g. name,designation,company
ALTER TABLE messages ADD COLUMN payload TEXT;        -- WhatsApp API payload (for retry)
