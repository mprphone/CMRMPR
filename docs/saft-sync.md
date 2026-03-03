# SAFT Sync Robot

Este projeto inclui um robô para recolher dados do Dossier SAFT Online e gravar no CRM.

## 1) Configuração

Preencher no `.env`:

```env
Email_saft=
Senha_saft=
VITE_SUPABASE_URL_CMR=
VITE_SUPABASE_KEY_CMR=
```

Opcional:

```env
SAFT_BASE_URL=https://app.saftonline.pt
SAFT_HEADLESS=false
SAFT_MAX_CLIENTS=0
SAFT_DOWNLOAD_ATTACHMENTS=true
SAFT_ATTACHMENTS_BUCKET=attachments
SUPABASE_SERVICE_ROLE_KEY=
```

## 2) Instalar dependências

```bash
npm install
```

## 3) Executar sincronização

```bash
npm run saft:sync:headed
```

Use `:headed` para permitir login manual/captcha quando necessário.

## 4) Onde aparece na app

No detalhe do cliente (`Clientes` -> abrir cliente), existe o bloco `Dossier SAFT Online`.
No detalhe do cliente, o separador `Dossier SAFT` mostra estado e anexos importados.

Os dados são lidos da tabela:

`public.saft_dossier_data`
