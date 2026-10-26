# Studio MV

Site institucional e painel administrativo (`/boss`) da Studio MV.

## Estrutura
- `index.html`: site público.
- `logo.png`: logo oficial, usada no site e no painel.
- `_redirects`: envia `/adm` para `/boss` na Cloudflare Pages.
- `boss/index.html`, `boss/styles.css`, `boss/app.js`: painel administrativo.
- `supabase/schema.sql`: tabelas, regras de acesso (RLS), funções, histórico e arquivos.

## Configuração (fazer antes de publicar)
1. No Supabase, rode `supabase/schema.sql` inteiro no SQL Editor. Pode ser executado de novo sem erro.
2. Em **Authentication > Users**, crie o usuário `studiomvcontato@gmail.com` com senha forte e confirme o e-mail.
3. Em **Authentication > Sign In / Providers**, desative **Allow new users to sign up**.
4. Em **Authentication > URL Configuration**, use o endereço publicado do site como Site URL e adicione `<endereço>/boss/` em Redirect URLs. Isso faz o link de recuperação de senha funcionar.
5. Em `index.html` e em `boss/app.js`, troque `SUPABASE_URL` e `SUPABASE_KEY` pelos dados do projeto (Project Settings > API). Use somente a chave **publishable**. Nunca use a chave `service_role`.

## Publicação
A Cloudflare Pages publica a pasta na raiz do repositório a cada `git push` na branch principal. Não há comando de build.

## Limites conhecidos
- Listas carregam até 1.000 registros (limite padrão do Supabase). Para mais, será preciso paginar.
- A galeria de fotos do portfólio ainda não existe: cada projeto tem uma imagem de capa.
- Os pagamentos são registrados manualmente. Nada é marcado como recebido automaticamente.
