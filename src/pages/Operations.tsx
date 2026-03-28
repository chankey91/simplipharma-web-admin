import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Grid,
  Alert,
} from '@mui/material';
import { Add, Delete, Settings } from '@mui/icons-material';
import {
  useTrays,
  useOperators,
  useAddTray,
  useAddOperator,
  useDeleteTray,
  useDeleteOperator,
} from '../hooks/useOperations';
import { Loading } from '../components/Loading';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export const OperationsPage: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [newTrayName, setNewTrayName] = useState('');
  const [newOperatorName, setNewOperatorName] = useState('');

  const {
    data: trays,
    isLoading: traysLoading,
    isError: traysIsError,
    error: traysError,
    refetch: refetchTrays,
  } = useTrays();
  const {
    data: operators,
    isLoading: operatorsLoading,
    isError: operatorsIsError,
    error: operatorsError,
    refetch: refetchOperators,
  } = useOperators();
  const addTrayMutation = useAddTray();
  const addOperatorMutation = useAddOperator();
  const deleteTrayMutation = useDeleteTray();
  const deleteOperatorMutation = useDeleteOperator();

  const handleAddTray = async () => {
    if (!newTrayName.trim()) return;
    try {
      await addTrayMutation.mutateAsync(newTrayName.trim());
      setNewTrayName('');
    } catch (err: any) {
      alert(err.message || 'Failed to add tray');
    }
  };

  const handleAddOperator = async () => {
    if (!newOperatorName.trim()) return;
    try {
      await addOperatorMutation.mutateAsync(newOperatorName.trim());
      setNewOperatorName('');
    } catch (err: any) {
      alert(err.message || 'Failed to add operator');
    }
  };

  const handleDeleteTray = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tray?')) return;
    try {
      await deleteTrayMutation.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Failed to delete tray');
    }
  };

  const handleDeleteOperator = async (id: string) => {
    if (!confirm('Are you sure you want to delete this operator?')) return;
    try {
      await deleteOperatorMutation.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Failed to delete operator');
    }
  };

  if (tabValue === 0 && traysLoading && !traysIsError) {
    return <Loading message="Loading trays..." />;
  }
  if (tabValue === 1 && operatorsLoading && !operatorsIsError) {
    return <Loading message="Loading operators..." />;
  }

  const traysErrMsg = traysIsError
    ? (traysError as Error)?.message || 'Failed to load trays'
    : '';
  const operatorsErrMsg = operatorsIsError
    ? (operatorsError as Error)?.message || 'Failed to load operators'
    : '';

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={3}>
        <Settings sx={{ mr: 2, fontSize: 32 }} />
        <Typography variant="h4">Operations</Typography>
      </Box>

      {(traysIsError || operatorsIsError) && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                refetchTrays();
                refetchOperators();
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="subtitle2" gutterBottom>
            Firestore permission or network error — trays/operators could not be loaded.
          </Typography>
          {traysIsError && <Typography variant="body2">Trays: {traysErrMsg}</Typography>}
          {operatorsIsError && <Typography variant="body2">Operators: {operatorsErrMsg}</Typography>}
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            Deploy latest <code>firestore.rules</code> (must include <code>trays</code> and <code>operators</code>{' '}
            matches before the catch‑all rule). Run: <code>firebase deploy --only firestore:rules</code>
          </Typography>
        </Alert>
      )}

      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab label="Tray Numbers" />
          <Tab label="Operators" />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Manage Tray Numbers
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Add tray numbers that will appear in the dropdown when processing orders.
            </Typography>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  fullWidth
                  label="Tray Number / Name"
                  value={newTrayName}
                  onChange={(e) => setNewTrayName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTray()}
                  placeholder="e.g. Tray-01, A1, etc."
                />
              </Grid>
              <Grid item>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddTray}
                  disabled={!newTrayName.trim() || addTrayMutation.isPending}
                >
                  Add Tray
                </Button>
              </Grid>
            </Grid>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tray Number</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {traysIsError ? (
                    <TableRow>
                      <TableCell colSpan={2} align="center">
                        <Typography color="error" sx={{ py: 2 }}>
                          {traysErrMsg}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (!trays || trays.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={2} align="center">
                        <Typography color="textSecondary" sx={{ py: 2 }}>
                          No trays added yet. Add tray numbers above.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    trays.map((tray) => (
                      <TableRow key={tray.id}>
                        <TableCell>{tray.name}</TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteTray(tray.id)}
                            disabled={deleteTrayMutation.isPending}
                          >
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Manage Operators
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Add operator names that will appear in the "Processed By" dropdown when fulfilling orders.
            </Typography>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  fullWidth
                  label="Operator Name"
                  value={newOperatorName}
                  onChange={(e) => setNewOperatorName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddOperator()}
                  placeholder="e.g. John Doe, Priya Sharma"
                />
              </Grid>
              <Grid item>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddOperator}
                  disabled={!newOperatorName.trim() || addOperatorMutation.isPending}
                >
                  Add Operator
                </Button>
              </Grid>
            </Grid>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Operator Name</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {operatorsIsError ? (
                    <TableRow>
                      <TableCell colSpan={2} align="center">
                        <Typography color="error" sx={{ py: 2 }}>
                          {operatorsErrMsg}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (!operators || operators.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={2} align="center">
                        <Typography color="textSecondary" sx={{ py: 2 }}>
                          No operators added yet. Add operator names above.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    operators.map((op) => (
                      <TableRow key={op.id}>
                        <TableCell>{op.name}</TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteOperator(op.id)}
                            disabled={deleteOperatorMutation.isPending}
                          >
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </TabPanel>
      </Paper>
    </Box>
  );
};
