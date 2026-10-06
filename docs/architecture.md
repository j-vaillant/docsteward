# Architecture

Le processus principal Electron détient les seules capacités natives : authentification auprès d’`independentweb-api`, cycle de vie, sélecteur de dossier, stockage des autorisations et ouverture du dossier de journaux. Il génère à chaque lancement un secret de 256 bits puis crée le serveur avec `utilityProcess.fork()`.

Le serveur reçoit sa configuration par message versionné et validé, écoute uniquement sur `127.0.0.1:0`, puis retourne son port réel. La session Electron non persistante injecte le bearer token seulement vers cette origine exacte. Le renderer React utilise ensuite une API HTTP classique sans connaître le secret ni les chemins absolus.

Les autorisations sont représentées par un identifiant UUID, un nom d’affichage et un chemin conservé uniquement dans les processus privilégiés. Elles sont cloisonnées localement par identifiant de compte. Le serveur applique la politique de fichiers à chaque requête et refuse les API métier en l’absence de session utilisateur.

Le JWT DocSteward reste uniquement en mémoire dans le processus principal et le serveur local. Pour les fonctions IA, il est utilisé auprès du proxy compatible OpenAI exposé sous `/docsteward/openai/v1`. La véritable clé OpenAI reste chiffrée dans la base DocSteward d’IndependentWeb.
