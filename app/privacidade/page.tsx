import LegalPage from "@/components/legal-page";

export const metadata = { title: "Política de privacidade — RN Integra" };

export default function PrivacyPage() {
  return <LegalPage title="Política de privacidade" sections={[
    ["1. Quem somos e papéis na LGPD", ["Para os dados de pacientes e da agenda, a organização contratante é a controladora e o RN Integra é o operador. Para os dados de cadastro das pessoas que usam o sistema (nome, e-mail, acesso), o RN Integra é o controlador."]],
    ["2. Dados tratados", ["Usuários: nome, e-mail, papel, senha (guardada apenas como hash), registros de acesso e de alterações.", "Pacientes (registrados pela organização): nome, documento, contato, convênio, dados da agenda e histórico de atendimentos, que podem incluir dados sensíveis de saúde."]],
    ["3. Finalidades e bases legais", ["Prestar o serviço de agenda, manter a segurança e a auditoria, cumprir obrigações legais e atender a pedidos dos titulares. Os dados de saúde são tratados para a tutela da saúde e a execução do contrato com a organização contratante."]],
    ["4. Compartilhamento", ["Não vendemos dados. Usamos fornecedores de infraestrutura (hospedagem, banco de dados e envio de e-mail) sob contrato e com dados armazenados no Brasil sempre que possível. Cada organização só acessa os próprios dados."]],
    ["5. Segurança", ["Conexões criptografadas, senhas com derivação forte, isolamento por organização no banco, registros de auditoria e limites de tentativa de acesso."]],
    ["6. Retenção e exclusão", ["Os dados são mantidos enquanto durar o contrato e pelo prazo exigido por lei. Ao fim do contrato, a organização pode pedir a exportação; depois, os dados são eliminados ou anonimizados, salvo obrigação legal de guarda."]],
    ["7. Direitos dos titulares", ["Pacientes devem exercer seus direitos (acesso, correção, eliminação etc.) junto à organização que os atende; o RN Integra apoia a organização no atendimento. Usuários podem pedir diretamente ao RN Integra pelo canal de contato."]],
    ["8. Encarregado (DPO) e contato", ["Encarregado pelo tratamento de dados: a definir antes da abertura do cadastro ao público."]],
  ]} />;
}
